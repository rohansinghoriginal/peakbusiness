import { NextResponse } from 'next/server'

import { ApiError, assert, date, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('material_purchases')
      .select('*,suppliers!inner(supplier_name),materials!inner(material_code,material_name)')
      .eq('owner_user_id', ownerUserId)
      .order('purchase_date', { ascending: false })
      .limit(300)
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
    const supplierId = text(body.supplierId)
    const materialId = text(body.materialId)
    const quantity = number(body.quantity)
    assert(supplierId && materialId && quantity > 0, 'Supplier, material, and a positive quantity are required.')
    const db = getSupabaseAdmin()
    const [supplierResult, materialResult] = await Promise.all([
      db.from('suppliers').select('id').eq('id', supplierId).eq('owner_user_id', ownerUserId).maybeSingle(),
      db.from('materials').select('id').eq('id', materialId).eq('owner_user_id', ownerUserId).maybeSingle(),
    ])
    if (supplierResult.error) throw supplierResult.error
    if (materialResult.error) throw materialResult.error
    if (!supplierResult.data || !materialResult.data) throw new ApiError('Supplier or material is outside this workspace.', 404)

    const unitPrice = Math.max(0, number(body.unitPrice))
    const gstRate = Math.max(0, number(body.gstRate))
    const transportCost = Math.max(0, number(body.transportCost))
    const subtotal = quantity * unitPrice
    const gstAmount = (subtotal * gstRate) / 100
    const invoiceNo = optionalText(body.invoiceNo)
    const { data: purchase, error } = await db
      .from('material_purchases')
      .upsert(
        {
          owner_user_id: ownerUserId,
          purchase_date: date(body.purchaseDate),
          supplier_id: supplierId,
          material_id: materialId,
          quantity,
          unit: text(body.unit) || 'pcs',
          unit_price: unitPrice,
          subtotal,
          gst_rate: gstRate,
          gst_amount: gstAmount,
          transport_cost: transportCost,
          total_amount: subtotal + gstAmount + transportCost,
          invoice_no: invoiceNo,
          notes: optionalText(body.notes),
        },
        { onConflict: 'owner_user_id,invoice_no,material_id' },
      )
      .select()
      .single()
    if (error) throw error

    const { error: removeLedgerError } = await db
      .from('material_transactions')
      .delete()
      .eq('owner_user_id', ownerUserId)
      .eq('source', 'PURCHASE')
      .eq('reference', purchase.id)
    if (removeLedgerError) throw removeLedgerError
    const { error: addLedgerError } = await db.from('material_transactions').insert({
      owner_user_id: ownerUserId,
      txn_date: purchase.purchase_date,
      material_id: materialId,
      txn_type: 'PURCHASE_IN',
      qty_in: quantity,
      unit_cost: unitPrice,
      reference: purchase.id,
      source: 'PURCHASE',
      notes: purchase.notes,
    })
    if (addLedgerError) throw addLedgerError
    return NextResponse.json(purchase)
  } catch (error) {
    return jsonError(error)
  }
}
