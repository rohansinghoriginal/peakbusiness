import { normalizeSkuKey } from './business'

export type SkuRecord = { id: string; sku_code: string; sku_key?: string; selling_price: number | string }

/**
 * Master-row inputs for a single SKU encounter.
 * Only `skuCode`, `productName`, `salePrice` are required for order imports;
 * catalog imports may additionally supply cost/stock/category/active.
 */
export type EnsureSkuMasterInput = {
  db: any
  ownerUserId: string
  platform: string
  skuCode: string
  productName: string
  salePrice: number
  skuByKey: Map<string, SkuRecord>
  /** When true, refresh master fields on a repeat encounter (catalog imports). */
  updateExisting?: boolean
  costPerUnit?: number
  openingStock?: number
  reorderLevel?: number
  category?: string | null
  active?: boolean
  notes?: string | null
}

/**
 * Dedup-aware SKU master lookup.
 *
 * Identity is (owner_user_id, platform, normalizeSkuKey(sku_code)) — the
 * normalized key, NOT the raw code. Exact match only. On repeat encounter the
 * existing master row's id is reused; a new `skus` row is created only the
 * first time that normalized key is seen.
 *
 * Update semantics:
 *  - `updateExisting: false` (order/transaction imports): a repeat encounter
 *    NEVER overwrites the master row's price/cost fields. The sale's actual
 *    price is recorded on the order/transaction rows, so the master's
 *    catalog price stays stable and historical pricing is not corrupted.
 *  - `updateExisting: true` (SKU catalog sheet, manual catalog edits): the
 *    master row's catalog fields are refreshed from the sheet.
 */
export async function ensureSkuMaster(input: EnsureSkuMasterInput): Promise<{ sku: SkuRecord; created: boolean }> {
  const {
    db,
    ownerUserId,
    platform,
    skuCode,
    productName,
    salePrice,
    skuByKey,
    updateExisting = false,
  } = input

  const key = normalizeSkuKey(skuCode)
  const sku_code = String(skuCode ?? '').trim()
  if (!sku_code) throw new Error('SKU code is required.')

  const cacheKey = `${platform}::${key}`
  const cached = skuByKey.get(cacheKey)
  if (cached) {
    if (updateExisting) await refreshMaster(db, input, cached.id)
    return { sku: cached, created: false }
  }

  const { data: existing, error: lookError } = await db
    .from('skus')
    .select('id, sku_code, sku_key, selling_price')
    .eq('owner_user_id', ownerUserId)
    .eq('platform', platform)
    .eq('sku_key', key)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (lookError) throw lookError

  if (existing) {
    skuByKey.set(cacheKey, existing as SkuRecord)
    if (updateExisting) await refreshMaster(db, input, existing.id)
    return { sku: existing as SkuRecord, created: false }
  }

  const { data, error } = await db
    .from('skus')
    .insert({
      owner_user_id: ownerUserId,
      sku_code,
      sku_key: key,
      product_name: productName || sku_code,
      platform,
      selling_price: Math.max(0, salePrice),
      cost_per_unit: Math.max(0, input.costPerUnit ?? 0),
      opening_stock: Math.max(0, input.openingStock ?? 0),
      reorder_level: Math.max(0, input.reorderLevel ?? 0),
      category: input.category ?? null,
      active: input.active !== false,
      notes: input.notes || 'Auto-created from sales import',
    })
    .select('id, sku_code, sku_key, selling_price')
    .single()
  if (error) {
    // Unique violation — a concurrent import created the same normalized key
    // between our lookup and insert. Resolve to the existing row.
    if (error.code === '23505') {
      const { data: raced, error: raceError } = await db
        .from('skus')
        .select('id, sku_code, sku_key, selling_price')
        .eq('owner_user_id', ownerUserId)
        .eq('platform', platform)
        .eq('sku_key', key)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (raceError) throw raceError
      if (raced) {
        skuByKey.set(cacheKey, raced as SkuRecord)
        return { sku: raced as SkuRecord, created: false }
      }
    }
    throw error
  }

  const sku = data as SkuRecord
  skuByKey.set(cacheKey, sku)
  return { sku, created: true }
}

async function refreshMaster(db: any, input: EnsureSkuMasterInput, id: string): Promise<void> {
  const patch: Record<string, unknown> = {
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