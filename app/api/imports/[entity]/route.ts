import { NextResponse } from 'next/server'

import { assert, jsonError, requireUserId, text } from '@/lib/api'
import {
  createImportPlan,
  detectDocumentAndPlatform,
  deterministicMapping,
  deterministicMappingForEntity,
  inferMappingWithAI,
  parseUnstructuredTextToRows,
  serializeImportRows,
  type ImportMapping,
  type RawRow,
  type SheetImportPlan,
  type ImportPlan,
  type PlatformType,
  type EntityType,
} from '@/lib/import-mapping'
import { saveOrderWithLedger } from '@/lib/order-ledger'
import { ensureSkuMaster, type SkuRecord } from '@/lib/sku-master'
import { normalizeSkuKey } from '@/lib/business'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { env } from '@/lib/env'

async function handleAnalyze(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const formData = await request.formData()
    const file = formData.get('file') as File
    assert(file, 'No file provided.')

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Uploaded spreadsheet is too large. Maximum allowed size is 5 MB.')
    }

    const XLSX = require('xlsx')
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: false })
    const sheetNames = workbook.SheetNames

    const analyses = await Promise.all(
      sheetNames.map(async (sheetName: string) => {
        const sheet = workbook.Sheets[sheetName]
        const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false }) as RawRow[]
        const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : []
        const sampleRows = rawRows.slice(0, 5)

        const analysis = detectDocumentAndPlatform(headers, sampleRows, file.name)

        return { sheetName, entityType: 'unknown' as EntityType, platform: analysis.detectedPlatform, headers, rowCount: rawRows.length, sampleRows }
      })
    )

    return NextResponse.json({ fileName: file.name, sheets: analyses })
  } catch (error) {
    return jsonError(error)
  }
}

async function handleParseFile(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const { fileName, fileBase64, sheets: sheetsInput } = body
    assert(fileName && fileBase64 && Array.isArray(sheetsInput), 'Missing required fields.')

    const buffer = Buffer.from(fileBase64, 'base64')
    const XLSX = require('xlsx')
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: false })

    const sheets = await Promise.all(
      sheetsInput.map(async (sheet: any) => {
        const { sheetName, entityType, platform, mapping, headerRowIndex, targetTable, normalizedRows, platformValues, usePerRowPlatform, platformColumn } = sheet

        const ws = workbook.Sheets[sheetName]
        if (!ws) throw new Error(`Sheet "${sheetName}" not found in workbook.`)

        const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, blankrows: false })
        const rows = rawRows.slice((headerRowIndex ?? 0) + 1).map((row: any, i: number) => ({ ...row, __rowIndex: i }))

        let finalMapping = mapping
        if (!finalMapping || Object.keys(finalMapping).length === 0) {
          if (entityType) {
            const dm = deterministicMappingForEntity(entityType)
            if (dm) finalMapping = dm
          }
        }

        let plan: ImportPlan | null = null
        if (finalMapping && entityType) {
          // createImportPlan expects SheetAnalysis[] - create plan manually for single sheet
          const sheetPlan = {
            sheetName,
            platform: platform as PlatformType,
            docType: 'GENERIC_ORDER_DATA',
            docTypeName: 'Generic Order Data',
            rows: [],
            headers: [],
            mapping: finalMapping,
            rowCount: 0,
            confidence: 0.5,
            isPrimary: true,
            mergeWith: [],
            relationship: 'standalone',
            entityType: entityType as EntityType,
            entityConfidence: 0.5,
            targetTable: targetTable || entityType,
            normalizedRows: normalizedRows || rawRows,
            usePerRowPlatform: usePerRowPlatform || false,
            platformValues: platformValues || [],
            platformColumn: platformColumn || '',
          } as SheetImportPlan
          plan = {
            sheets: [sheetPlan],
            warnings: [],
          }
        }

        return {
          entityType,
          platform,
          rows,
          mapping: finalMapping || {},
          normalizedRows: normalizedRows || rows,
          sheetName,
          targetTable: targetTable || entityType,
          usePerRowPlatform: usePerRowPlatform || false,
          platformValues: platformValues || [],
          platformColumn: platformColumn || '',
          plan,
        }
      })
    )

    return NextResponse.json({ fileName, sheets })
  } catch (error) {
    return jsonError(error)
  }
}

async function handleMultiEntity(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const sheets = Array.isArray(body.sheets) ? body.sheets : []
    const fileName = body.fileName || 'multi-entity-import'
    assert(sheets.length > 0, 'No sheets provided for import.')

    const db = getSupabaseAdmin()

    const { data: allSkus, error: skuError } = await db.from('skus').select('id, sku_code, selling_price, platform').eq('owner_user_id', ownerUserId)
    if (skuError) throw skuError

    const skuByKey = new Map<string, SkuRecord>()
    for (const sku of allSkus || []) {
      skuByKey.set(`${sku.platform}::${normalizeSkuKey(sku.sku_code)}`, sku as SkuRecord)
    }

    const { data: allMaterials } = await db.from('materials').select('id, material_code, material_name, unit, avg_unit_cost').eq('owner_user_id', ownerUserId)
    const materialByCode = new Map<string, any>()
    for (const mat of allMaterials || []) {
      materialByCode.set(normalizeSkuKey(mat.material_code), mat)
    }

    const { data: allSuppliers } = await db.from('suppliers').select('id, supplier_name').eq('owner_user_id', ownerUserId)
    const supplierByName = new Map<string, any>()
    for (const sup of allSuppliers || []) {
      supplierByName.set(sup.supplier_name.toLowerCase().trim(), sup)
    }

    const { data: existingOrders } = await db.from('business_orders').select('line_key, platform').eq('owner_user_id', ownerUserId)
    const knownLineKeys = new Set<string>()
    for (const row of existingOrders || []) {
      knownLineKeys.add(`${row.platform}::${row.line_key}`)
    }

    let totalImported = 0
    let totalErrors = 0
    const results: Record<string, { imported: number; errors: number; duplicates: number; created: number }> = {}

    for (const sheet of sheets) {
      const { entityType, platform, rows, mapping, normalizedRows, sheetName } = sheet
      if (!rows.length) continue

      const entityResults = { imported: 0, errors: 0, duplicates: 0, created: 0 }
      const seenLineKeys = new Set<string>()

      try {
        switch (entityType) {
          case 'orders':
          case 'returns':
          case 'settlement':
            await importOrdersReturns({
              db,
              ownerUserId,
              platform,
              rows: normalizedRows || rows,
              mapping,
              entityType,
              sheetName: fileName,
              skuByKey,
              knownLineKeys,
              seenLineKeys,
              entityResults,
            })
            break
          case 'skus':
            await importSkus({
              db,
              ownerUserId,
              platform,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
              skuByKey,
            })
            break
          case 'materials':
            await importMaterials({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
              materialByCode,
            })
            break
          case 'borrowings':
            await importBorrowings({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
            })
            break
          case 'purchases':
            await importPurchases({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
              materialByCode,
              supplierByName,
            })
            break
          case 'expenses':
            await importExpenses({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
            })
            break
          case 'suppliers':
            await importSuppliers({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
            })
            break
          case 'sku_materials':
            await importSkuMaterials({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
              skuByKey,
              materialByCode,
            })
            break
          case 'material_transactions':
            await importMaterialTransactions({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults,
              materialByCode,
            })
            break
          default:
            entityResults.errors = rows.length
        }
      } catch (sheetError) {
        console.error(`Error importing sheet ${sheetName} (${entityType}):`, sheetError)
        entityResults.errors = rows.length
      }

      results[sheetName] = entityResults
      totalImported += entityResults.imported
      totalErrors += entityResults.errors
    }

    return NextResponse.json({ success: true, fileName, totalSheets: sheets.length, totalImported, totalErrors, sheetResults: results })
  } catch (error) {
    return jsonError(error)
  }
}

// Import handler functions
async function importOrdersReturns(ctx: any) {
  const { db, ownerUserId, platform, rows, mapping, entityType, sheetName, skuByKey, knownLineKeys, seenLineKeys, entityResults } = ctx
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const raw = rows[rowIdx]
    const rowPlatform = platform
    const orderId = String(raw.orderId ?? raw['Order ID'] ?? '').trim()
    const skuCodeRaw = String(raw.skuCode ?? raw['SKU Code'] ?? '').trim()
    if (!orderId || !skuCodeRaw) { entityResults.errors++; continue }

    const cachedSku = skuByKey.get(`${rowPlatform}::${normalizeSkuKey(skuCodeRaw)}`)
    const salePrice = Math.max(0, Number(raw.salePrice ?? cachedSku?.selling_price ?? 0))
    const productName = String(raw.productName ?? raw['Product Name'] ?? skuCodeRaw).trim()

    let skuRecord: SkuRecord
    try {
      const result = await ensureSkuMaster({
        db, ownerUserId, platform: rowPlatform, skuCode: skuCodeRaw, productName, salePrice,
        skuByKey, updateExisting: false, notes: `Auto-created from ${entityType} import`,
      })
      skuRecord = result.sku
      if (result.created) entityResults.created++
    } catch { entityResults.errors++; continue }

    const itemIdentity = String(raw.lineKey ?? raw['Line Key'] ?? skuRecord.id).trim()
    const lineKey = `${rowPlatform}::${orderId}::${itemIdentity}`
    if (knownLineKeys.has(lineKey) || seenLineKeys.has(lineKey)) { entityResults.duplicates++; continue }
    seenLineKeys.add(lineKey)

    const ordered = Math.max(0, Number(raw.qtyOrdered ?? 1))
    const status = String(raw.status ?? 'Pending')
    const deliveredValue = raw.qtyDelivered
    const deliveredFallback = /delivered|fulfilled|shipped|completed/i.test(status) ? ordered : 0
    const hasDeliveredColumn = deliveredValue !== undefined && String(deliveredValue).trim() !== ''
    let qtyDelivered = Math.max(0, hasDeliveredColumn ? Number(deliveredValue) : deliveredFallback)
    let qtyReturned = Math.max(0, Number(raw.qtyReturned ?? 0))
    if (entityType === 'returns' || status === 'Returned') {
      qtyReturned = Math.max(qtyReturned, ordered - qtyDelivered)
      qtyDelivered = Math.max(0, ordered - qtyReturned)
    }

    try {
      await saveOrderWithLedger({
        db, ownerUserId,
        input: {
          orderDate: String(raw.orderDate ?? ''),
          platform: rowPlatform, orderId, lineKey, skuId: skuRecord.id,
          qtyOrdered: ordered, qtyDelivered, qtyReturned,
          salePrice: Math.max(0, Number(raw.salePrice ?? Number(skuRecord.selling_price) ?? salePrice)),
          status: entityType === 'returns' ? 'Returned' : status,
          deliveryDate: raw.deliveryDate ? String(raw.deliveryDate) : null,
          returnDate: raw.returnDate ? String(raw.returnDate) : (status === 'Returned' ? String(raw.orderDate) : null),
          refundAmount: Math.max(0, Number(raw.refundAmount ?? 0)),
          customerLocation: String(raw.customerLocation ?? '').trim() || null,
          sourceFile: sheetName,
        },
        source: 'AUTO_IMPORT',
      })
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importSkus(ctx: any) {
  const { db, ownerUserId, platform, rows, mapping, entityResults, skuByKey } = ctx
  for (const raw of rows) {
    const skuCode = String(raw.skuCode ?? raw['SKU Code'] ?? '').trim()
    const productName = String(raw.productName ?? raw['Product Name'] ?? skuCode).trim()
    if (!skuCode) { entityResults.errors++; continue }

    const salePrice = Math.max(0, Number(raw.sellingPrice ?? 0))
    const costPerUnit = Math.max(0, Number(raw.costPerUnit ?? 0))
    const openingStock = Math.max(0, Number(raw.openingStock ?? 0))
    const reorderLevel = Math.max(0, Number(raw.reorderLevel ?? 0))
    const category = String(raw.category ?? '').trim() || null
    const active = raw.active !== false

    try {
      await ensureSkuMaster({
        db, ownerUserId, platform, skuCode, productName, salePrice, skuByKey,
        updateExisting: true, costPerUnit, openingStock, reorderLevel, category, active,
        notes: 'Imported from workbook',
      })
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importMaterials(ctx: any) {
  const { db, ownerUserId, rows, entityResults, materialByCode } = ctx
  for (const raw of rows) {
    const materialCode = String(raw.materialCode ?? raw['Material Code'] ?? '').trim()
    const materialName = String(raw.materialName ?? raw['Material Name'] ?? materialCode).trim()
    if (!materialCode) { entityResults.errors++; continue }

    const category = String(raw.category ?? '').trim() || null
    const unit = String(raw.unit ?? 'pcs').trim()
    const openingStock = Math.max(0, Number(raw.openingStock ?? 0))
    const reorderLevel = Math.max(0, Number(raw.reorderLevel ?? 0))
    const avgUnitCost = Math.max(0, Number(raw.avgUnitCost ?? 0))
    const preferredVendor = String(raw.preferredVendor ?? '').trim() || null

    try {
      const { error } = await db.from('materials').upsert({
        owner_user_id: ownerUserId, material_code: materialCode, material_name: materialName,
        category, unit, opening_stock: openingStock, reorder_level: reorderLevel,
        avg_unit_cost: avgUnitCost, preferred_vendor: preferredVendor, notes: 'Imported from workbook',
      }, { onConflict: 'owner_user_id,material_code' })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importBorrowings(ctx: any) {
  const { db, ownerUserId, rows, entityResults } = ctx
  for (const raw of rows) {
    const counterparty = String(raw.counterparty ?? raw['Counterparty'] ?? '').trim()
    const itemName = String(raw.itemName ?? raw['Item Name'] ?? '').trim()
    if (!counterparty || !itemName) { entityResults.errors++; continue }

    const direction = String(raw.direction ?? 'borrowed').toLowerCase().includes('lend') ? 'lent' : 'borrowed'
    const txnDate = String(raw.txnDate ?? '')
    const itemType = String(raw.itemType ?? 'Material').trim()
    const itemCode = String(raw.itemCode ?? '').trim() || null
    const quantity = Math.max(0, Number(raw.quantity ?? 1))
    const unitCost = Math.max(0, Number(raw.unitCost ?? 0))
    const dueDate = raw.dueDate ? String(raw.dueDate) : null
    const settlementStatus = String(raw.settlementStatus ?? 'Open').trim()

    try {
      const { error } = await db.from('borrowings').insert({
        owner_user_id: ownerUserId, direction, txn_date: txnDate, counterparty,
        item_type: itemType, item_code: itemCode, item_name: itemName,
        quantity, unit_cost: unitCost, due_date: dueDate, settlement_status: settlementStatus,
        notes: 'Imported from workbook',
      })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importPurchases(ctx: any) {
  const { db, ownerUserId, rows, entityResults, materialByCode, supplierByName } = ctx
  for (const raw of rows) {
    const materialCode = String(raw.materialId ?? raw['Material Code'] ?? '').trim()
    const supplierName = String(raw.supplierId ?? raw['Supplier'] ?? '').trim()
    if (!materialCode || !supplierName) { entityResults.errors++; continue }

    const material = materialByCode.get(normalizeSkuKey(materialCode))
    const supplier = supplierByName.get(supplierName.toLowerCase())
    if (!material || !supplier) { entityResults.errors++; continue }

    const purchaseDate = String(raw.purchaseDate ?? '')
    const quantity = Math.max(0, Number(raw.quantity ?? 1))
    const unit = String(raw.unit ?? material.unit ?? 'pcs').trim()
    const unitPrice = Math.max(0, Number(raw.unitPrice ?? 0))
    const gstRate = Math.max(0, Number(raw.gstRate ?? 0))
    const transportCost = Math.max(0, Number(raw.transportCost ?? 0))
    const invoiceNo = String(raw.invoiceNo ?? '').trim() || null

    const subtotal = quantity * unitPrice
    const gstAmount = subtotal * (gstRate / 100)
    const totalAmount = subtotal + gstAmount + transportCost

    try {
      const { error } = await db.from('material_purchases').insert({
        owner_user_id: ownerUserId, purchase_date: purchaseDate, supplier_id: supplier.id,
        material_id: material.id, quantity, unit, unit_price: unitPrice,
        subtotal, gst_rate: gstRate, gst_amount: gstAmount, transport_cost: transportCost,
        total_amount: totalAmount, invoice_no: invoiceNo, notes: 'Imported from workbook',
      })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importExpenses(ctx: any) {
  const { db, ownerUserId, rows, entityResults } = ctx
  for (const raw of rows) {
    const amount = Math.max(0, Number(raw.amount ?? 0))
    const category = String(raw.category ?? '').trim()
    const description = String(raw.description ?? '').trim()
    const expenseDate = String(raw.expenseDate ?? '')
    const platform = String(raw.platform ?? '').trim() || null
    if (amount === 0 || !category) { entityResults.errors++; continue }

    try {
      const { error } = await db.from('business_expenses').insert({
        owner_user_id: ownerUserId, expense_date: expenseDate, category, amount,
        description: description || null, platform: platform || null,
      })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importSuppliers(ctx: any) {
  const { db, ownerUserId, rows, entityResults } = ctx
  for (const raw of rows) {
    const supplierName = String(raw.supplierName ?? raw['Supplier Name'] ?? '').trim()
    if (!supplierName) { entityResults.errors++; continue }

    const address = String(raw.address ?? '').trim() || null
    const gstin = String(raw.gstin ?? '').trim() || null
    const phone = String(raw.phone ?? '').trim() || null
    const email = String(raw.email ?? '').trim() || null
    const defaultGstRate = Math.max(0, Number(raw.defaultGstRate ?? 0))
    const defaultTransportCost = Math.max(0, Number(raw.defaultTransportCost ?? 0))

    try {
      const { error } = await db.from('suppliers').upsert({
        owner_user_id: ownerUserId, supplier_name: supplierName, address, gstin, phone, email,
        default_gst_rate: defaultGstRate, default_transport_cost: defaultTransportCost,
        notes: 'Imported from workbook',
      }, { onConflict: 'owner_user_id,supplier_name' })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importSkuMaterials(ctx: any) {
  const { db, ownerUserId, platform, rows, entityResults, skuByKey, materialByCode } = ctx
  for (const raw of rows) {
    const skuCode = String(raw.skuCode ?? raw['SKU Code'] ?? '').trim()
    const materialCode = String(raw.materialCode ?? raw['Material Code'] ?? '').trim()
    if (!skuCode || !materialCode) { entityResults.errors++; continue }

    const sku = skuByKey.get(`${platform}::${normalizeSkuKey(skuCode)}`)
    const material = materialByCode.get(normalizeSkuKey(materialCode))
    if (!sku || !material) { entityResults.errors++; continue }

    const qtyPerUnit = Math.max(0, Number(raw.qtyPerUnit ?? 0))
    const wastePct = Math.max(0, Number(raw.wastePct ?? 0))

    try {
      const { error } = await db.from('sku_materials').upsert({
        owner_user_id: ownerUserId, sku_id: sku.id, material_id: material.id,
        qty_per_unit: qtyPerUnit, waste_pct: wastePct,
      }, { onConflict: 'owner_user_id,sku_id,material_id' })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function importMaterialTransactions(ctx: any) {
  const { db, ownerUserId, rows, entityResults, materialByCode } = ctx
  for (const raw of rows) {
    const materialCode = String(raw.materialId ?? raw['Material Code'] ?? '').trim()
    if (!materialCode) { entityResults.errors++; continue }

    const material = materialByCode.get(normalizeSkuKey(materialCode))
    if (!material) { entityResults.errors++; continue }

    const txnDate = String(raw.txnDate ?? '')
    const txnType = String(raw.txnType ?? 'ADJUSTMENT').toUpperCase()
    const qtyIn = Math.max(0, Number(raw.qtyIn ?? 0))
    const qtyOut = Math.max(0, Number(raw.qtyOut ?? 0))
    const unitCost = Math.max(0, Number(raw.unitCost ?? 0))
    const reference = String(raw.reference ?? '').trim() || null
    const source = String(raw.source ?? 'IMPORT').trim()

    try {
      const { error } = await db.from('material_transactions').insert({
        owner_user_id: ownerUserId, txn_date: txnDate, material_id: material.id,
        txn_type: txnType, qty_in: qtyIn, qty_out: qtyOut, unit_cost: unitCost,
        reference, source, notes: 'Imported from workbook',
      })
      if (error) throw error
      entityResults.imported++
    } catch { entityResults.errors++ }
  }
}

async function handleTemplates(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const { searchParams } = new URL(request.url)
    const entityType = searchParams.get('entityType')

    const db = getSupabaseAdmin()
    let query = db.from('import_templates').select().eq('owner_user_id', ownerUserId).order('usage_count', { ascending: false })
    if (entityType) query = query.eq('entity_type', entityType)

    const { data, error } = await query.limit(20)
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ownerUserId = await requireUserId()
    const { entity } = await params

    switch (entity) {
      case 'analyze':
        return handleAnalyze(request)
      case 'parse-file':
        return NextResponse.json({ error: 'Use POST' }, { status: 405 })
      case 'multi-entity':
        return NextResponse.json({ error: 'Use POST' }, { status: 405 })
      case 'templates':
        return handleTemplates(request)
      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const { entity } = await params

    switch (entity) {
      case 'parse-file':
        return handleParseFile(request)
      case 'multi-entity':
        return handleMultiEntity(request)
      case 'analyze':
        return handleAnalyze(request)
      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return jsonError(error)
  }
}