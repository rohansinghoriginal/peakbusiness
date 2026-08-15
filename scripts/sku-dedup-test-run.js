// Standalone JS harness for SKU dedup test
// Ports normalizeSkuKey and ensureSkuMaster logic into plain JS and runs the test input.

function normalizeSkuKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// In-memory fake DB (same behaviour as TypeScript harness)
const TABLES = {
  skus: { rows: [], uniqueKeys: ['owner_user_id,platform,sku_key'] },
  business_orders: { rows: [], uniqueKeys: ['owner_user_id,platform,line_key'] },
  sku_transactions: { rows: [], uniqueKeys: [] },
}

let nextId = 1
function genId() { return `id-${nextId++}` }

function matches(row, filters) { return filters.every(([k, v]) => row[k] === v) }

function tableRows(name) { return TABLES[name].rows }

function checkUnique(name, newRow, exceptIndex = -1) {
  const table = TABLES[name]
  for (const key of table.uniqueKeys) {
    const cols = key.split(',').map((c) => c.trim())
    for (let i = 0; i < table.rows.length; i++) {
      if (i === exceptIndex) continue
      const existing = table.rows[i]
      if (cols.every((c) => existing[c] === newRow[c])) {
        return { code: '23505', message: `duplicate key value violates unique constraint on ${key}` }
      }
    }
  }
  return null
}

class Builder {
  constructor(name) {
    this.name = name
    this.cols = null
    this.filters = []
    this.orderBy = null
    this.limitN = null
    this.mode = null
    this.payload = null
    this.onConflict = null
  }
  select(cols) { if (!this.mode) this.mode = 'select'; this.cols = cols ? cols.split(',').map(c=>c.trim()) : null; return this }
  insert(payload) { this.mode = 'insert'; this.payload = payload; return this }
  upsert(payload, opts) { this.mode='upsert'; this.payload=payload; this.onConflict=opts?.onConflict ?? null; return this }
  update(payload) { this.mode='update'; this.payload=payload; return this }
  delete() { this.mode='delete'; return this }
  eq(col, val) { this.filters.push([col, val]); return this }
  order(col, opts) { this.orderBy = [col, opts?.ascending ?? true]; return this }
  limit(n) { this.limitN = n; return this }

  runSelect() {
    let rows = tableRows(this.name).filter(r => matches(r, this.filters))
    if (this.orderBy) {
      const [col, asc] = this.orderBy
      rows = [...rows].sort((a,b)=>{
        const av = new Date(a[col] ?? 0).getTime() - new Date(b[col] ?? 0).getTime()
        return asc ? av : -av
      })
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
    if (this.cols) rows = rows.map(r => Object.fromEntries(this.cols.map(c=>[c, r[c]])))
    return rows
  }

  async maybeSingle() { if (this.mode === 'select') { const rows = this.runSelect(); return { data: rows[0] ?? null, error: null } } return { data: null, error: { code: 'bad', message: 'maybeSingle on non-select' } } }

  async single() {
    if (this.mode === 'select') {
      const rows = this.runSelect()
      if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'The result contains 0 rows' } }
      if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'The result contains more than one row' } }
      return { data: rows[0], error: null }
    }
    if (this.mode === 'insert' || this.mode === 'upsert') return this.execWrite()
    return { data: null, error: { code: 'bad', message: 'single on unsupported mode' } }
  }

  async execWrite() {
    const table = TABLES[this.name]
    const list = Array.isArray(this.payload) ? this.payload : [this.payload]
    for (const row of list) {
      if (this.mode === 'upsert' && this.onConflict) {
        const cols = this.onConflict.split(',').map(c=>c.trim())
        const conflictIdx = table.rows.findIndex(existing => cols.every(c => existing[c] === row[c]))
        if (conflictIdx >= 0) {
          const merged = { ...table.rows[conflictIdx], ...row, id: table.rows[conflictIdx].id }
          table.rows[conflictIdx] = merged
          return { data: merged, error: null }
        }
      }
      const conflict = checkUnique(this.name, row)
      if (conflict) return { data: null, error: conflict }
      const newRow = { ...row, id: genId() }
      table.rows.push(newRow)
      return { data: newRow, error: null }
    }
    return { data: null, error: null }
  }
}

const db = { from: (name) => new Builder(name) }

// ensureSkuMaster ported from src/lib/sku-master.ts
async function ensureSkuMaster(input) {
  const { db, ownerUserId, platform, skuCode, productName, salePrice, skuByKey, updateExisting = false } = input
  const key = normalizeSkuKey(skuCode)
  const sku_code = String(skuCode ?? '').trim()
  if (!sku_code) throw new Error('SKU code is required.')
  const cacheKey = `${platform}::${key}`
  const cached = skuByKey.get(cacheKey)
  if (cached) {
    if (updateExisting) await refreshMaster(db, input, cached.id)
    return { sku: cached, created: false }
  }

  const { data: existing, error: lookError } = await db.from('skus').select('id, sku_code, sku_key, selling_price').eq('owner_user_id', ownerUserId).eq('platform', platform).eq('sku_key', key).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (lookError) throw lookError
  if (existing) { skuByKey.set(cacheKey, existing); if (updateExisting) await refreshMaster(db, input, existing.id); return { sku: existing, created: false } }

  const { data, error } = await db.from('skus').insert({ owner_user_id: ownerUserId, sku_code, sku_key: key, product_name: productName || sku_code, platform, selling_price: Math.max(0, salePrice), cost_per_unit: Math.max(0, input.costPerUnit ?? 0), opening_stock: Math.max(0, input.openingStock ?? 0), reorder_level: Math.max(0, input.reorderLevel ?? 0), category: input.category ?? null, active: input.active !== false, notes: input.notes || 'Auto-created from sales import' }).select('id, sku_code, sku_key, selling_price').single()
  if (error) {
    if (error.code === '23505') {
      const { data: raced, error: raceError } = await db.from('skus').select('id, sku_code, sku_key, selling_price').eq('owner_user_id', ownerUserId).eq('platform', platform).eq('sku_key', key).order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (raceError) throw raceError
      if (raced) { skuByKey.set(cacheKey, raced); return { sku: raced, created: false } }
    }
    throw error
  }
  const sku = data
  skuByKey.set(cacheKey, sku)
  return { sku, created: true }
}

async function refreshMaster(db, input, id) {
  const patch = {
    product_name: input.productName || String(input.skuCode ?? '').trim(),
    selling_price: Math.max(0, input.salePrice),
    cost_per_unit: Math.max(0, input.costPerUnit ?? 0),
    opening_stock: Math.max(0, input.openingStock ?? 0),
    reorder_level: Math.max(0, input.reorderLevel ?? 0),
    category: input.category ?? null,
    active: input.active !== false,
  }
  if (input.notes) patch.notes = input.notes
  const { error } = await db.from('skus').update(patch).eq('id', id).eq('owner_user_id', input.ownerUserId)
  if (error) throw error
}

// import loop and test
const ownerUserId = 'owner-1'
const platform = 'Amazon'

function importNumber(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback }

async function importSales(rows) {
  const skuByKey = new Map()
  let createdSkus = 0
  let imported = 0
  for (const raw of rows) {
    const orderId = String(raw.orderId ?? '')
    const skuCode = String(raw.skuCode ?? '')
    if (!orderId || !skuCode) continue
    const salePrice = Math.max(0, importNumber(raw.salePrice, 0))
    const productName = String(raw.productName ?? skuCode)
    const { sku, created } = await ensureSkuMaster({ db, ownerUserId, platform, skuCode, productName, salePrice, skuByKey, updateExisting: false })
    if (created) createdSkus++
    const lineKey = `${orderId}::${sku.id}`
    const { data: order, error: orderError } = await db.from('business_orders').insert({ owner_user_id: ownerUserId, platform, order_id: orderId, line_key: lineKey, sku_id: sku.id, qty_ordered: 1, qty_delivered: 1, qty_returned: 0, sale_price: salePrice, status: 'Delivered', order_date: '2026-08-01' }).select().single()
    if (orderError) throw new Error(`order insert failed: ${orderError.message}`)
    const { error: txnError } = await db.from('sku_transactions').insert({ owner_user_id: ownerUserId, sku_id: sku.id, txn_type: 'SALE_OUT', qty_out: 1, order_id: order.id, source: 'AUTO_IMPORT' }).single()
    if (txnError) throw new Error(`txn insert failed: ${txnError.message}`)
    imported++
  }
  return { createdSkus, imported }
}

const input = [
  { orderId: 'o1', skuCode: 'mouse-mod-1' },
  { orderId: 'o2', skuCode: 'mouse-mod-2' },
  { orderId: 'o3', skuCode: 'mouse-mod-2' },
  { orderId: 'o4', skuCode: 'mouse-mod-2' },
  { orderId: 'o5', skuCode: 'mouse-mod-3' },
  { orderId: 'o6', skuCode: 'mouse-mod-3' },
  { orderId: 'o7', skuCode: 'stylemouse1' },
  { orderId: 'o8', skuCode: 'stylemouse1' },
  { orderId: 'o9', skuCode: 'stylemouse1' },
  { orderId: 'o10', skuCode: 'stylemouse2' },
  { orderId: 'o11', skuCode: 'headphone0101' },
  { orderId: 'o12', skuCode: 'headphone0101' },
  { orderId: 'o13', skuCode: 'headphone0102' },
]

async function main() {
  const result = await importSales(input)
  const skuRows = TABLES.skus.rows
  const orderRows = TABLES.business_orders.rows
  const txnRows = TABLES.sku_transactions.rows
  const uniqueNormalized = new Set(skuRows.map(r => `${r.platform}::${normalizeSkuKey(r.sku_code)}`))
  console.log('--- Phase 4 dedup test ---')
  console.log(`input rows            : ${input.length}`)
  console.log(`skus rows (master)    : ${skuRows.length}`)
  console.log(`unique normalized keys: ${uniqueNormalized.size}`)
  console.log(`business_orders rows  : ${orderRows.length}`)
  console.log(`sku_transactions rows : ${txnRows.length}`)
  console.log(`createdSkus reported  : ${result.createdSkus}`)
  console.log(`sku rows by code      : ${JSON.stringify(skuRows.map(r => r.sku_code))}`)
  const checks = [
    ['skus rows == 7', skuRows.length === 7],
    ['no duplicate normalized key', uniqueNormalized.size === skuRows.length],
    ['business_orders rows == 13', orderRows.length === 13],
    ['sku_transactions rows == 13', txnRows.length === 13],
    ['createdSkus == 7', result.createdSkus === 7],
  ]
  let pass = true
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) pass = false
  }
  // Case variant
  const before = TABLES.skus.rows.length
  const variantRow = { orderId: 'o14', skuCode: 'MOUSE-MOD-2', salePrice: 999 }
  await importSales([variantRow])
  const after = TABLES.skus.rows.length
  const variantReused = after === before && TABLES.business_orders.rows.length === 14
  console.log(`${variantReused ? 'PASS' : 'FAIL'}  case-variant MOUSE-MOD-2 reuses master row (skus ${before} -> ${after})`)
  if (!variantReused) pass = false
  console.log(pass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED')
  process.exitCode = pass ? 0 : 1
}

main().catch(e => { console.error('Harness error:', e); process.exitCode = 1 })
