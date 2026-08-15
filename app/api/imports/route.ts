import { NextResponse } from 'next/server'

import { assert, jsonError, requireUserId, text } from '@/lib/api'
import {
  importDate,
  importNumber,
  normalizeImportStatus,
  valueFor,
  type ImportMapping,
  type RawRow,
} from '@/lib/import-mapping'
import { normalizeSkuKey } from '@/lib/business'
import { saveOrderWithLedger } from '@/lib/order-ledger'
import { ensureSkuMaster, type SkuRecord } from '@/lib/sku-master'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('sales_import_batches')
      .select()
      .eq('owner_user_id', ownerUserId)
      .order('imported_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const platform = text(body.platform) || 'Offline'
    const sourceFile = text(body.sourceFile) || 'Marketplace report'
    const rows = Array.isArray(body.rows) ? (body.rows.slice(0, 10000) as RawRow[]) : []
    const mapping = (body.mapping && typeof body.mapping === 'object' ? body.mapping : {}) as ImportMapping
    assert(rows.length, 'This report does not contain any data rows.')

    const db = getSupabaseAdmin()
    const { data: skus, error: skuError } = await db
      .from('skus')
      .select('id,sku_code,selling_price')
      .eq('owner_user_id', ownerUserId)
      .eq('platform', platform)
    if (skuError) throw skuError

    const skuByCode = new Map<string, SkuRecord>(
      (skus || []).map((sku) => [`${platform}::${normalizeSkuKey(sku.sku_code)}`, sku as SkuRecord]),
    )

    const { data: existing, error: existingError } = await db
      .from('business_orders')
      .select('line_key')
      .eq('owner_user_id', ownerUserId)
      .eq('platform', platform)
    if (existingError) throw existingError

    const knownLineKeys = new Set((existing || []).map((row) => row.line_key))
    const seenLineKeys = new Set<string>()
    let duplicateRows = 0
    let unmatchedRows = 0
    let createdSkus = 0

    const prepared: Array<{
      orderDate: string
      platform: string
      orderId: string
      lineKey: string
      skuId: string
      qtyOrdered: number
      qtyDelivered: number
      qtyReturned: number
      salePrice: number
      status: string
      deliveryDate: string | null
      returnDate: string | null
      refundAmount: number
      customerLocation: string | null
      sourceFile: string
    }> = []

    for (const raw of rows) {
      const orderId = text(valueFor(raw, 'orderId', mapping))
      const skuCodeRaw = text(valueFor(raw, 'skuCode', mapping))
      if (!orderId || !skuCodeRaw) {
        unmatchedRows += 1
        continue
      }

      const salePrice = Math.max(
        0,
        importNumber(valueFor(raw, 'salePrice', mapping), Number(skuByCode.get(`${platform}::${normalizeSkuKey(skuCodeRaw)}`)?.selling_price || 0)),
      )
      const productName = text(valueFor(raw, 'productName', mapping)) || skuCodeRaw
      const { sku, created } = await ensureSkuMaster({
        db,
        ownerUserId,
        platform,
        skuCode: skuCodeRaw,
        productName,
        salePrice,
        skuByKey: skuByCode,
        updateExisting: false,
      })
      if (created) createdSkus += 1

      const itemIdentity = text(valueFor(raw, 'lineKey', mapping)) || sku.id
      const lineKey = `${orderId}::${itemIdentity}`
      if (knownLineKeys.has(lineKey) || seenLineKeys.has(lineKey)) {
        duplicateRows += 1
        continue
      }
      seenLineKeys.add(lineKey)

      const ordered = Math.max(0, importNumber(valueFor(raw, 'qtyOrdered', mapping), 1))
      const status = normalizeImportStatus(valueFor(raw, 'status', mapping))
      const deliveredValue = valueFor(raw, 'qtyDelivered', mapping)
      const deliveredFallback = /delivered|fulfilled|shipped|completed/i.test(status) ? ordered : 0
      const hasDeliveredColumn = deliveredValue !== undefined && String(deliveredValue).trim() !== ''

      prepared.push({
        orderDate: importDate(valueFor(raw, 'orderDate', mapping)),
        platform,
        orderId,
        lineKey,
        skuId: sku.id,
        qtyOrdered: ordered,
        qtyDelivered: Math.max(0, hasDeliveredColumn ? importNumber(deliveredValue) : deliveredFallback),
        qtyReturned: Math.max(0, importNumber(valueFor(raw, 'qtyReturned', mapping))),
        salePrice: Math.max(0, importNumber(valueFor(raw, 'salePrice', mapping), Number(sku.selling_price) || salePrice)),
        status,
        deliveryDate: valueFor(raw, 'deliveryDate', mapping) ? importDate(valueFor(raw, 'deliveryDate', mapping)) : null,
        returnDate: valueFor(raw, 'returnDate', mapping) ? importDate(valueFor(raw, 'returnDate', mapping)) : null,
        refundAmount: Math.max(0, importNumber(valueFor(raw, 'refundAmount', mapping))),
        customerLocation: text(valueFor(raw, 'customerLocation', mapping)) || null,
        sourceFile,
      })
    }

    const { data: batch, error: batchError } = await db
      .from('sales_import_batches')
      .insert({
        owner_user_id: ownerUserId,
        platform,
        file_name: sourceFile,
        total_rows: rows.length,
        duplicate_rows: duplicateRows,
        unmatched_rows: unmatchedRows,
      })
      .select()
      .single()
    if (batchError) throw batchError

    let importedRows = 0
    let errorRows = 0
    for (const order of prepared) {
      try {
        await saveOrderWithLedger({
          db,
          ownerUserId,
          input: { ...order, importBatchId: batch.id, sourceFile },
          source: 'AUTO_IMPORT',
        })
        importedRows += 1
      } catch (error) {
        console.error('Unable to import row', error)
        errorRows += 1
      }
    }

    const { error: updateError } = await db
      .from('sales_import_batches')
      .update({ imported_rows: importedRows, error_rows: errorRows })
      .eq('id', batch.id)
      .eq('owner_user_id', ownerUserId)
    if (updateError) throw updateError

    return NextResponse.json({
      batchId: batch.id,
      totalRows: rows.length,
      importedRows,
      duplicateRows,
      unmatchedRows,
      errorRows,
      createdSkus,
      mappingUsed: Object.keys(mapping).length > 0,
    })
  } catch (error) {
    return jsonError(error)
  }
}
