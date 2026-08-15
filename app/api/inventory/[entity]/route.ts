import { NextResponse } from 'next/server'

import { assert, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

async function handleMaterialTransactions(request: Request, ownerUserId: string) {
  const { searchParams } = new URL(request.url)
  const materialId = searchParams.get('materialId')
  const limit = parseInt(searchParams.get('limit') || '250')

  const db = getSupabaseAdmin()
  let query = db.from('material_transactions').select('*, materials(*)').eq('owner_user_id', ownerUserId)
  if (materialId) query = query.eq('material_id', materialId)
  query = query.order('txn_date', { ascending: false }).limit(limit)

  const { data, error } = await query
  if (error) throw error
  return NextResponse.json(data)
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ownerUserId = await requireUserId()
    const { entity } = await params

    switch (entity) {
      case 'material-transactions':
        return handleMaterialTransactions(request, ownerUserId)
      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const { entity } = await params

    if (entity !== 'material-transactions') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const db = getSupabaseAdmin()
    const { material_id, txn_date, txn_type, qty_in, qty_out, unit_cost, reference, source } = body
    assert(material_id && txn_date && txn_type, 'Required fields missing.')

    const { data, error } = await db.from('material_transactions').insert({
      owner_user_id: ownerUserId,
      material_id,
      txn_date,
      txn_type: String(txn_type).toUpperCase(),
      qty_in: Math.max(0, number(qty_in ?? 0)),
      qty_out: Math.max(0, number(qty_out ?? 0)),
      unit_cost: Math.max(0, number(unit_cost ?? 0)),
      reference: body.reference || null,
      source: body.source || 'MANUAL',
      notes: body.notes || null,
    }).select().single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}