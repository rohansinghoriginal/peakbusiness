import { ApiError, databaseError, date, number, optionalText, text } from '@/lib/api'
import { stableLineKey } from '@/lib/business'

export type OrderInput = {
  id?: string
  orderDate?: unknown
  platform?: unknown
  orderId?: unknown
  lineKey?: unknown
  skuId?: unknown
  qtyOrdered?: unknown
  qtyDelivered?: unknown
  qtyReturned?: unknown
  salePrice?: unknown
  status?: unknown
  deliveryDate?: unknown
  returnDate?: unknown
  customerLocation?: unknown
  refundAmount?: unknown
  notes?: unknown
  importBatchId?: string | null
  sourceFile?: string | null
  entityType?: 'order' | 'return' | 'settlement' | 'exchange' | 'adjustment'
}

/**
 * Acquire advisory lock for SKU to prevent concurrent ledger modifications
 */
async function acquireSkuLock(db: any, skuId: string): Promise<void> {
  const lockId = await db.rpc('get_sku_advisory_lock_id', { p_sku_id: skuId })
  const { error } = await db.rpc('pg_advisory_xact_lock', { lockid: lockId })
  if (error) throw new ApiError(`Failed to acquire SKU lock: ${error.message}`)
}

/**
 * Acquire advisory lock for material to prevent concurrent ledger modifications
 */
async function acquireMaterialLock(db: any, materialId: string): Promise<void> {
  const lockId = await db.rpc('get_material_advisory_lock_id', { p_material_id: materialId })
  const { error } = await db.rpc('pg_advisory_xact_lock', { lockid: lockId })
  if (error) throw new ApiError(`Failed to acquire material lock: ${error.message}`)
}

/**
 * Capture BOM snapshot at order creation for historical accuracy
 */
async function captureBomSnapshot(
  db: any,
  ownerUserId: string,
  skuId: string,
  qtyDelivered: number
): Promise<any[]> {
  const { data: bom, error } = await db
    .from('sku_materials')
    .select('material_id, qty_per_unit, waste_pct, materials!inner(avg_unit_cost, material_code, material_name)')
    .eq('owner_user_id', ownerUserId)
    .eq('sku_id', skuId)

  if (error) databaseError(error)
  if (!bom || bom.length === 0) return []

  return bom.map((line: any) => {
    const material = Array.isArray(line.materials) ? line.materials[0] : line.materials
    const quantity = Number(qtyDelivered) * Number(line.qty_per_unit || 0) * (1 + Number(line.waste_pct || 0) / 100)
    return {
      material_id: line.material_id,
      material_code: material?.material_code,
      material_name: material?.material_name,
      qty_per_unit: line.qty_per_unit,
      waste_pct: line.waste_pct,
      quantity_consumed: quantity,
      unit_cost_at_consumption: material?.avg_unit_cost || 0,
    }
  }).filter((b: any) => b.quantity_consumed > 0)
}

/**
 * Save order with double-entry ledger using advisory locks for concurrency control
 * and BOM snapshot for historical accuracy.
 */
export async function saveOrderWithLedger({
  db,
  ownerUserId,
  input,
  source,
}: {
  db: any
  ownerUserId: string
  input: OrderInput
  source: 'MANUAL_ORDER' | 'AUTO_IMPORT'
}) {
  const skuId = text(input.skuId)
  const orderId = text(input.orderId)
  if (!skuId || !orderId) throw new ApiError('Order ID and SKU are required.')

  // Fetch SKU with current cost (maintained by WAC)
  const { data: sku, error: skuError } = await db
    .from('skus')
    .select('id, cost_per_unit')
    .eq('id', skuId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
  if (skuError) databaseError(skuError)
  if (!sku) throw new ApiError('The selected SKU does not belong to your workspace.', 404)

  const platform = text(input.platform) || 'Offline'
  const entityType = input.entityType || (text(input.status) === 'Returned' ? 'return' : 'order')
  const qtyDelivered = Math.max(0, number(input.qtyDelivered))
  const qtyReturned = Math.max(0, number(input.qtyReturned))

  // Capture BOM snapshot BEFORE any ledger modifications
  const bomSnapshot = await captureBomSnapshot(db, ownerUserId, skuId, qtyDelivered)

  // Build order payload
  const payload = {
    owner_user_id: ownerUserId,
    order_date: date(input.orderDate),
    platform,
    order_id: orderId,
    line_key: stableLineKey(orderId, skuId, text(input.lineKey)),
    sku_id: skuId,
    qty_ordered: Math.max(0, number(input.qtyOrdered, 1)),
    qty_delivered: qtyDelivered,
    qty_returned: qtyReturned,
    sale_price: Math.max(0, number(input.salePrice)),
    status: text(input.status) || 'Pending',
    entity_type: entityType,
    delivery_date: input.deliveryDate ? date(input.deliveryDate) : null,
    return_date: input.returnDate ? date(input.returnDate) : null,
    customer_location: optionalText(input.customerLocation),
    refund_amount: Math.max(0, number(input.refundAmount)),
    notes: optionalText(input.notes),
    import_batch_id: input.importBatchId || null,
    source_file: input.sourceFile || null,
    bom_snapshot: bomSnapshot.length > 0 ? bomSnapshot : null,
  }

  // Upsert order (includes BOM snapshot)
  const { data: order, error: orderError } = await db
    .from('business_orders')
    .upsert(payload, { onConflict: 'owner_user_id,platform,line_key' })
    .select()
    .single()
  if (orderError) databaseError(orderError)

  // Acquire advisory locks for concurrency control
  await acquireSkuLock(db, order.sku_id)
  if (bomSnapshot.length > 0) {
    for (const bomLine of bomSnapshot) {
      await acquireMaterialLock(db, bomLine.material_id)
    }
  }

  // Delete existing ledger entries for this order (idempotent upsert pattern)
  await db.from('sku_transactions').delete().eq('owner_user_id', ownerUserId).eq('order_id', order.id).eq('source', source)
  await db.from('material_transactions').delete().eq('owner_user_id', ownerUserId).eq('order_id', order.id).eq('source', source)

  const txnDate = order.delivery_date || order.order_date
  const skuCost = sku.cost_per_unit // Maintained by WAC on SKU

  // SKU Ledger: Sale Out (delivered units)
  if (Number(order.qty_delivered) > 0) {
    const { error: saleError } = await db.from('sku_transactions').insert({
      owner_user_id: ownerUserId,
      txn_date: txnDate,
      sku_id: order.sku_id,
      txn_type: 'SALE_OUT',
      qty_out: order.qty_delivered,
      unit_cost: skuCost,
      order_id: order.id,
      reference: order.order_id,
      source,
    })
    if (saleError) databaseError(saleError)
  }

  // Material Ledger: Consumption via BOM (uses snapshot for historical accuracy)
  if (bomSnapshot.length > 0) {
    const materialRows = bomSnapshot.map((line) => ({
      owner_user_id: ownerUserId,
      txn_date: txnDate,
      material_id: line.material_id,
      txn_type: 'SALE_OUT',
      qty_out: line.quantity_consumed,
      unit_cost: line.unit_cost_at_consumption, // Historical cost from snapshot
      order_id: order.id,
      sku_id: order.sku_id,
      reference: order.order_id,
      source,
    }))

    const { error: consumptionError } = await db.from('material_transactions').insert(materialRows)
    if (consumptionError) databaseError(consumptionError)
  }

  // SKU Ledger: Return In (returned units restored at current cost)
  if (Number(order.qty_returned) > 0) {
    const returnDate = order.return_date || order.order_date
    const { error: returnError } = await db.from('sku_transactions').insert({
      owner_user_id: ownerUserId,
      txn_date: returnDate,
      sku_id: order.sku_id,
      txn_type: 'RETURN_IN',
      qty_in: order.qty_returned,
      unit_cost: skuCost, // Current cost at return time
      order_id: order.id,
      reference: order.order_id,
      source,
    })
    if (returnError) databaseError(returnError)
  }

  return order
}