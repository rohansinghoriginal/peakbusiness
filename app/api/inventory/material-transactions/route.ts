import { NextResponse } from 'next/server'

import { ApiError, assert, date, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const materialId = text(body.materialId)
    assert(materialId, 'A material is required.')
    const db = getSupabaseAdmin()
    const { data: material, error: materialError } = await db.from('materials').select('id').eq('id', materialId).eq('owner_user_id', ownerUserId).maybeSingle()
    if (materialError) throw materialError
    if (!material) throw new ApiError('Material not found.', 404)
    const { data, error } = await db
      .from('material_transactions')
      .insert({
        owner_user_id: ownerUserId,
        txn_date: date(body.txnDate),
        material_id: materialId,
        txn_type: text(body.txnType) || 'ADJUSTMENT',
        qty_in: Math.max(0, number(body.qtyIn)),
        qty_out: Math.max(0, number(body.qtyOut)),
        unit_cost: Math.max(0, number(body.unitCost)),
        reference: optionalText(body.reference),
        notes: optionalText(body.notes),
        source: 'MANUAL',
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
