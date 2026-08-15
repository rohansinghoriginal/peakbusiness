import { NextResponse } from 'next/server'

import { ApiError, assert, date, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('borrowings')
      .select()
      .eq('owner_user_id', ownerUserId)
      .order('txn_date', { ascending: false })
      .limit(250)
    if (error) throw error
    return NextResponse.json(
      (data || []).map((row) => ({
        ...row,
        outstanding_qty: number(row.qty) - number(row.qty_returned),
        outstanding_value: (number(row.qty) - number(row.qty_returned)) * number(row.unit_cost),
      })),
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const quantity = Math.max(0, number(body.quantity))
    assert(text(body.counterparty) && text(body.itemName) && quantity > 0, 'Counterparty, item name, and a positive quantity are required.')
    const { data, error } = await getSupabaseAdmin()
      .from('borrowings')
      .insert({
        owner_user_id: ownerUserId,
        direction: text(body.direction) === 'lent' ? 'lent' : 'borrowed',
        txn_date: date(body.txnDate),
        counterparty: text(body.counterparty),
        item_type: text(body.itemType) || 'Material',
        item_code: optionalText(body.itemCode),
        item_name: text(body.itemName),
        qty: quantity,
        unit_cost: Math.max(0, number(body.unitCost)),
        qty_returned: Math.min(quantity, Math.max(0, number(body.quantityReturned))),
        due_date: body.dueDate ? date(body.dueDate) : null,
        notes: optionalText(body.notes),
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const id = text(body.id)
    assert(id, 'Borrowing record ID is required.')
    const { data: existing, error: fetchError } = await getSupabaseAdmin().from('borrowings').select('qty').eq('id', id).eq('owner_user_id', ownerUserId).maybeSingle()
    if (fetchError) throw fetchError
    if (!existing) throw new ApiError('Borrowing record not found.', 404)
    const { data, error } = await getSupabaseAdmin()
      .from('borrowings')
      .update({
        qty_returned: Math.min(number(existing.qty), Math.max(0, number(body.quantityReturned))),
        return_date: body.returnDate ? date(body.returnDate) : null,
        settlement_status: text(body.settlementStatus) || 'Open',
        notes: optionalText(body.notes),
      })
      .eq('id', id)
      .eq('owner_user_id', ownerUserId)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
