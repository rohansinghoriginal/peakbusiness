import { NextResponse } from 'next/server'

import { assert, jsonError, requireUserId } from '@/lib/api'
import {
  importDate,
  importNumber,
  normalizeImportStatus,
  skuLookupKey,
  type ImportMapping,
  type RawRow,
} from '@/lib/import-mapping'
import { normalizeSkuKey } from '@/lib/business'
import { saveOrderWithLedger } from '@/lib/order-ledger'
import { ensureSkuMaster, type SkuRecord } from '@/lib/sku-master'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    
    const sheets = Array.isArray(body.sheets) ? body.sheets : []
    const fileName = body.fileName || 'multi-entity-import'
    
    assert(sheets.length > 0, 'No sheets provided for import.')

    const db = getSupabaseAdmin()
    
    // Pre-load all SKUs for all platforms to avoid repeated queries
    const { data: allSkus, error: skuError } = await db
      .from('skus')
      .select('id, sku_code, selling_price, platform')
      .eq('owner_user_id', ownerUserId)
    if (skuError) throw skuError

    // Flat cache keyed by `${platform}::${normalizeSkuKey(sku_code)}` — one
    // entry per (owner, platform, normalized code). Mirrors the master-table
    // dedup identity so repeat codes reuse the same skus row.
    const skuByKey = new Map<string, SkuRecord>()
    for (const sku of allSkus || []) {
      skuByKey.set(`${sku.platform}::${normalizeSkuKey(sku.sku_code)}`, sku as SkuRecord)
    }

    // Pre-load materials
    const { data: allMaterials, error: matError } = await db
      .from('materials')
      .select('id, material_code, material_name, unit, avg_unit_cost')
      .eq('owner_user_id', ownerUserId)
    if (matError) throw matError

    const materialByCode = new Map<string, any>()
    for (const mat of allMaterials || []) {
      materialByCode.set(skuLookupKey(mat.material_code), mat)
    }

    // Pre-load suppliers
    const { data: allSuppliers, error: supError } = await db
      .from('suppliers')
      .select('id, supplier_name')
      .eq('owner_user_id', ownerUserId)
    if (supError) throw supError

    const supplierByName = new Map<string, any>()
    for (const sup of allSuppliers || []) {
      supplierByName.set(sup.supplier_name.toLowerCase().trim(), sup)
    }

    // Pre-load existing orders for duplicate detection
    const { data: existingOrders, error: ordError } = await db
      .from('business_orders')
      .select('line_key, platform')
      .eq('owner_user_id', ownerUserId)
    if (ordError) throw ordError

    const knownLineKeys = new Set<string>()
    for (const row of existingOrders || []) {
      knownLineKeys.add(`${row.platform}::${row.line_key}`)
    }

    let totalImported = 0
    let totalErrors = 0
    const results: Record<string, { imported: number; errors: number; duplicates: number; created: number }> = {}

    // Process each sheet in the import plan
    for (const sheet of sheets) {
      const { 
        entityType, 
        platform, 
        rows, 
        mapping, 
        normalizedRows,
        sheetName,
        targetTable 
      } = sheet

      if (!rows.length) continue

      const entityResults = { imported: 0, errors: 0, duplicates: 0, created: 0 }
      const seenLineKeys = new Set<string>()

      try {
        switch (entityType) {
          case 'orders':
          case 'returns':
          case 'settlement':
            // Import orders/returns
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
              entityResults: entityResults,
              // Per-row platform support
              usePerRowPlatform: sheet.usePerRowPlatform,
              platformValues: sheet.platformValues,
              platformColumn: sheet.platformColumn,
            })
            break

          case 'skus':
            // Import SKUs
            await importSkus({
              db,
              ownerUserId,
              platform,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
              skuByKey,
            })
            break

          case 'materials':
            // Import materials
            await importMaterials({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
            })
            break

          case 'borrowings':
            // Import borrowings
            await importBorrowings({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
            })
            break

          case 'purchases':
            // Import purchases
            await importPurchases({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
              materialByCode,
              supplierByName,
            })
            break

          case 'expenses':
            // Import expenses
            await importExpenses({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
            })
            break

          case 'suppliers':
            // Import suppliers
            await importSuppliers({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
            })
            break

          case 'sku_materials':
            // Import SKU-Material BOM
            await importSkuMaterials({
              db,
              ownerUserId,
              platform,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
              skuByKey,
              materialByCode,
            })
            break

          case 'material_transactions':
            // Import material transactions
            await importMaterialTransactions({
              db,
              ownerUserId,
              rows: normalizedRows || rows,
              mapping,
              entityResults: entityResults,
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

    return NextResponse.json({
      success: true,
      fileName,
      totalSheets: sheets.length,
      totalImported,
      totalErrors,
      sheetResults: results,
    })
  } catch (error) {
    return jsonError(error)
  }
}

interface ImportContext {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  platform: string
  rows: RawRow[]
  mapping: ImportMapping
  entityType: string
  sheetName: string
  skuByKey: Map<string, SkuRecord>
  knownLineKeys: Set<string>
  seenLineKeys: Set<string>
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
  // Per-row platform support
  usePerRowPlatform?: boolean
  platformValues?: string[]
  platformColumn?: string
}

async function importOrdersReturns(ctx: ImportContext) {
  const { db, ownerUserId, platform, rows, mapping, entityType, sheetName, skuByKey, knownLineKeys, seenLineKeys, entityResults, usePerRowPlatform, platformValues } = ctx

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const raw = rows[rowIdx]
    // Get platform for this specific row
    const rowPlatform = usePerRowPlatform && platformValues?.[rowIdx] ? platformValues[rowIdx] : platform
    const orderId = String(raw.orderId ?? raw['Order ID'] ?? '').trim()
    const skuCodeRaw = String(raw.skuCode ?? raw['SKU Code'] ?? '').trim()
    
    if (!orderId || !skuCodeRaw) {
      entityResults.errors++
      continue
    }

    // Determine sale price from mapping or SKU
    const cachedSku = skuByKey.get(`${rowPlatform}::${normalizeSkuKey(skuCodeRaw)}`)
    const salePrice = Math.max(0, importNumber(raw.salePrice, Number(cachedSku?.selling_price || 0)))
    const productName = String(raw.productName ?? raw['Product Name'] ?? skuCodeRaw).trim()
    
    // Ensure SKU exists - use row-specific platform
    let skuRecord: SkuRecord
    try {
      const result = await ensureSkuMaster({
        db,
        ownerUserId,
        platform: rowPlatform,
        skuCode: skuCodeRaw,
        productName,
        salePrice,
        skuByKey,
        updateExisting: false,
        notes: `Auto-created from ${entityType} import`,
      })
      skuRecord = result.sku
      if (result.created) entityResults.created++
    } catch (error) {
      console.error('SKU ensure error:', error)
      entityResults.errors++
      continue
    }

    const itemIdentity = String(raw.lineKey ?? raw['Line Key'] ?? skuRecord.id).trim()
    const lineKey = `${rowPlatform}::${orderId}::${itemIdentity}`
    
    if (knownLineKeys.has(lineKey) || seenLineKeys.has(lineKey)) {
      entityResults.duplicates++
      continue
    }
    seenLineKeys.add(lineKey)

    const ordered = Math.max(0, importNumber(raw.qtyOrdered, 1))
    const status = normalizeImportStatus(raw.status)
    const deliveredValue = raw.qtyDelivered
    const deliveredFallback = /delivered|fulfilled|shipped|completed/i.test(status) ? ordered : 0
    const hasDeliveredColumn = deliveredValue !== undefined && String(deliveredValue).trim() !== ''

    // For returns, adjust quantities
    let qtyDelivered = Math.max(0, hasDeliveredColumn ? importNumber(deliveredValue) : deliveredFallback)
    let qtyReturned = Math.max(0, importNumber(raw.qtyReturned))
    
    if (entityType === 'returns' || status === 'Returned') {
      qtyReturned = Math.max(qtyReturned, ordered - qtyDelivered)
      qtyDelivered = Math.max(0, ordered - qtyReturned)
    }

    try {
      await saveOrderWithLedger({
        db,
        ownerUserId,
        input: {
          orderDate: importDate(raw.orderDate),
          platform: rowPlatform,
          orderId,
          lineKey,
          skuId: skuRecord.id,
          qtyOrdered: ordered,
          qtyDelivered,
          qtyReturned,
          salePrice: Math.max(0, importNumber(raw.salePrice, Number(skuRecord.selling_price))),
          status: entityType === 'returns' ? 'Returned' : status,
          deliveryDate: raw.deliveryDate ? importDate(raw.deliveryDate) : null,
          returnDate: raw.returnDate ? importDate(raw.returnDate) : (status === 'Returned' ? importDate(raw.orderDate) : null),
          refundAmount: Math.max(0, importNumber(raw.refundAmount)),
          customerLocation: String(raw.customerLocation ?? '').trim() || null,
          sourceFile: sheetName,
        },
        source: 'AUTO_IMPORT',
      })
      entityResults.imported++
    } catch (error) {
      console.error('Order import error:', error)
      entityResults.errors++
    }
  }
}

async function importSkus(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  platform: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
  skuByKey: Map<string, SkuRecord>
}) {
  const { db, ownerUserId, platform, rows, mapping, entityResults, skuByKey } = ctx

  for (const raw of rows) {
    const skuCode = String(raw.skuCode ?? raw['SKU Code'] ?? '').trim()
    const productName = String(raw.productName ?? raw['Product Name'] ?? skuCode).trim()
    
    if (!skuCode) {
      entityResults.errors++
      continue
    }

    const salePrice = Math.max(0, importNumber(raw.sellingPrice, 0))
    const costPerUnit = Math.max(0, importNumber(raw.costPerUnit, 0))
    const openingStock = Math.max(0, importNumber(raw.openingStock, 0))
    const reorderLevel = Math.max(0, importNumber(raw.reorderLevel, 0))
    const category = String(raw.category ?? '').trim() || null
    const active = raw.active !== false

    try {
      await ensureSkuMaster({
        db,
        ownerUserId,
        platform,
        skuCode,
        productName,
        salePrice,
        skuByKey,
        updateExisting: true,
        costPerUnit,
        openingStock,
        reorderLevel,
        category,
        active,
        notes: 'Imported from workbook',
      })
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importMaterials(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
}) {
  const { db, ownerUserId, rows, mapping, entityResults } = ctx

  for (const raw of rows) {
    const materialCode = String(raw.materialCode ?? raw['Material Code'] ?? '').trim()
    const materialName = String(raw.materialName ?? raw['Material Name'] ?? materialCode).trim()
    
    if (!materialCode) {
      entityResults.errors++
      continue
    }

    const category = String(raw.category ?? '').trim() || null
    const unit = String(raw.unit ?? 'pcs').trim()
    const openingStock = Math.max(0, importNumber(raw.openingStock, 0))
    const reorderLevel = Math.max(0, importNumber(raw.reorderLevel, 0))
    const avgUnitCost = Math.max(0, importNumber(raw.avgUnitCost, 0))
    const preferredVendor = String(raw.preferredVendor ?? '').trim() || null

    try {
      const { error } = await db
        .from('materials')
        .upsert({
          owner_user_id: ownerUserId,
          material_code: materialCode,
          material_name: materialName,
          category,
          unit,
          opening_stock: openingStock,
          reorder_level: reorderLevel,
          avg_unit_cost: avgUnitCost,
          preferred_vendor: preferredVendor,
          notes: 'Imported from workbook',
        }, { onConflict: 'owner_user_id,material_code' })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importBorrowings(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
}) {
  const { db, ownerUserId, rows, mapping, entityResults } = ctx

  for (const raw of rows) {
    const counterparty = String(raw.counterparty ?? raw['Counterparty'] ?? '').trim()
    const itemName = String(raw.itemName ?? raw['Item Name'] ?? '').trim()
    
    if (!counterparty || !itemName) {
      entityResults.errors++
      continue
    }

    const direction = String(raw.direction ?? 'borrowed').toLowerCase().includes('lend') ? 'lent' : 'borrowed'
    const txnDate = importDate(raw.txnDate)
    const itemType = String(raw.itemType ?? 'Material').trim()
    const itemCode = String(raw.itemCode ?? '').trim() || null
    const quantity = Math.max(0, importNumber(raw.quantity, 1))
    const unitCost = Math.max(0, importNumber(raw.unitCost, 0))
    const dueDate = raw.dueDate ? importDate(raw.dueDate) : null
    const settlementStatus = String(raw.settlementStatus ?? 'Open').trim()

    try {
      const { error } = await db
        .from('borrowings')
        .insert({
          owner_user_id: ownerUserId,
          direction,
          txn_date: txnDate,
          counterparty,
          item_type: itemType,
          item_code: itemCode,
          item_name: itemName,
          quantity,
          unit_cost: unitCost,
          due_date: dueDate,
          settlement_status: settlementStatus,
          notes: 'Imported from workbook',
        })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importPurchases(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
  materialByCode: Map<string, any>
  supplierByName: Map<string, any>
}) {
  const { db, ownerUserId, rows, mapping, entityResults, materialByCode, supplierByName } = ctx

  for (const raw of rows) {
    const materialCode = String(raw.materialId ?? raw['Material Code'] ?? '').trim()
    const supplierName = String(raw.supplierId ?? raw['Supplier'] ?? '').trim()
    
    if (!materialCode || !supplierName) {
      entityResults.errors++
      continue
    }

    const material = materialByCode.get(skuLookupKey(materialCode))
    const supplier = supplierByName.get(supplierName.toLowerCase())
    
    if (!material || !supplier) {
      entityResults.errors++
      continue
    }

    const purchaseDate = importDate(raw.purchaseDate)
    const quantity = Math.max(0, importNumber(raw.quantity, 1))
    const unit = String(raw.unit ?? material.unit ?? 'pcs').trim()
    const unitPrice = Math.max(0, importNumber(raw.unitPrice, 0))
    const gstRate = Math.max(0, importNumber(raw.gstRate, 0))
    const transportCost = Math.max(0, importNumber(raw.transportCost, 0))
    const invoiceNo = String(raw.invoiceNo ?? '').trim() || null

    const subtotal = quantity * unitPrice
    const gstAmount = subtotal * (gstRate / 100)
    const totalAmount = subtotal + gstAmount + transportCost

    try {
      const { error } = await db
        .from('material_purchases')
        .insert({
          owner_user_id: ownerUserId,
          purchase_date: purchaseDate,
          supplier_id: supplier.id,
          material_id: material.id,
          quantity,
          unit,
          unit_price: unitPrice,
          subtotal,
          gst_rate: gstRate,
          gst_amount: gstAmount,
          transport_cost: transportCost,
          total_amount: totalAmount,
          invoice_no: invoiceNo,
          notes: 'Imported from workbook',
        })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importExpenses(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
}) {
  const { db, ownerUserId, rows, mapping, entityResults } = ctx

  for (const raw of rows) {
    const amount = Math.max(0, importNumber(raw.amount, 0))
    const category = String(raw.category ?? '').trim()
    const description = String(raw.description ?? '').trim()
    const expenseDate = importDate(raw.expenseDate)
    const platform = String(raw.platform ?? '').trim() || null

    if (amount === 0 || !category) {
      entityResults.errors++
      continue
    }

    try {
      const { error } = await db
        .from('business_expenses')
        .insert({
          owner_user_id: ownerUserId,
          expense_date: expenseDate,
          category,
          amount,
          description: description || null,
          platform: platform || null,
        })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importSuppliers(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
}) {
  const { db, ownerUserId, rows, mapping, entityResults } = ctx

  for (const raw of rows) {
    const supplierName = String(raw.supplierName ?? raw['Supplier Name'] ?? '').trim()
    
    if (!supplierName) {
      entityResults.errors++
      continue
    }

    const address = String(raw.address ?? '').trim() || null
    const gstin = String(raw.gstin ?? '').trim() || null
    const phone = String(raw.phone ?? '').trim() || null
    const email = String(raw.email ?? '').trim() || null
    const defaultGstRate = Math.max(0, importNumber(raw.defaultGstRate, 0))
    const defaultTransportCost = Math.max(0, importNumber(raw.defaultTransportCost, 0))

    try {
      const { error } = await db
        .from('suppliers')
        .upsert({
          owner_user_id: ownerUserId,
          supplier_name: supplierName,
          address,
          gstin,
          phone,
          email,
          default_gst_rate: defaultGstRate,
          default_transport_cost: defaultTransportCost,
          notes: 'Imported from workbook',
        }, { onConflict: 'owner_user_id,supplier_name' })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importSkuMaterials(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  platform: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
  skuByKey: Map<string, SkuRecord>
  materialByCode: Map<string, any>
}) {
  const { db, ownerUserId, platform, rows, mapping, entityResults, skuByKey, materialByCode } = ctx

  for (const raw of rows) {
    const skuCode = String(raw.skuCode ?? raw['SKU Code'] ?? '').trim()
    const materialCode = String(raw.materialCode ?? raw['Material Code'] ?? '').trim()
    
    if (!skuCode || !materialCode) {
      entityResults.errors++
      continue
    }

    const sku = skuByKey.get(`${platform}::${normalizeSkuKey(skuCode)}`)
    const material = materialByCode.get(skuLookupKey(materialCode))
    
    if (!sku || !material) {
      entityResults.errors++
      continue
    }

    const qtyPerUnit = Math.max(0, importNumber(raw.qtyPerUnit, 0))
    const wastePct = Math.max(0, importNumber(raw.wastePct, 0))

    try {
      const { error } = await db
        .from('sku_materials')
        .upsert({
          owner_user_id: ownerUserId,
          sku_id: sku.id,
          material_id: material.id,
          qty_per_unit: qtyPerUnit,
          waste_pct: wastePct,
        }, { onConflict: 'owner_user_id,sku_id,material_id' })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}

async function importMaterialTransactions(ctx: {
  db: ReturnType<typeof getSupabaseAdmin>
  ownerUserId: string
  rows: RawRow[]
  mapping: ImportMapping
  entityResults: { imported: number; errors: number; duplicates: number; created: number }
  materialByCode: Map<string, any>
}) {
  const { db, ownerUserId, rows, mapping, entityResults, materialByCode } = ctx

  for (const raw of rows) {
    const materialCode = String(raw.materialId ?? raw['Material Code'] ?? '').trim()
    
    if (!materialCode) {
      entityResults.errors++
      continue
    }

    const material = materialByCode.get(skuLookupKey(materialCode))
    if (!material) {
      entityResults.errors++
      continue
    }

    const txnDate = importDate(raw.txnDate)
    const txnType = String(raw.txnType ?? 'ADJUSTMENT').toUpperCase()
    const qtyIn = Math.max(0, importNumber(raw.qtyIn, 0))
    const qtyOut = Math.max(0, importNumber(raw.qtyOut, 0))
    const unitCost = Math.max(0, importNumber(raw.unitCost, 0))
    const reference = String(raw.reference ?? '').trim() || null
    const source = String(raw.source ?? 'IMPORT').trim()

    try {
      const { error } = await db
        .from('material_transactions')
        .insert({
          owner_user_id: ownerUserId,
          txn_date: txnDate,
          material_id: material.id,
          txn_type: txnType,
          qty_in: qtyIn,
          qty_out: qtyOut,
          unit_cost: unitCost,
          reference,
          source,
          notes: 'Imported from workbook',
        })
      
      if (error) throw error
      entityResults.imported++
    } catch (error) {
      entityResults.errors++
    }
  }
}