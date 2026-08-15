import { NextResponse } from 'next/server'

import { assert, jsonError, requireUserId } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

async function handleOrders(request: Request, ownerUserId: string) {
  const { searchParams } = new URL(request.url)
  const platform = searchParams.get('platform')
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') || '250')

  const db = getSupabaseAdmin()
  let query = db.from('business_orders').select('*, skus(*)').eq('owner_user_id', ownerUserId)
  if (platform) query = query.eq('platform', platform)
  if (status) query = query.eq('status', status)
  query = query.order('order_date', { ascending: false }).limit(limit)

  const { data, error } = await query
  if (error) throw error
  return NextResponse.json(data)
}

async function handleSearch(request: Request, ownerUserId: string) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  const platform = searchParams.get('platform')
  const limit = parseInt(searchParams.get('limit') || '50')

  if (!q) return NextResponse.json([])

  const db = getSupabaseAdmin()
  let query = db.from('business_orders')
    .select('id, order_id, order_date, platform, status, skus(sku_code, product_name), order_date')
    .eq('owner_user_id', ownerUserId)
    .or(`order_id.ilike.%${q}%,skus.sku_code.ilike.%${q}%,skus.product_name.ilike.%${q}%`)
  if (platform) query = query.eq('platform', platform)
  query = query.order('order_date', { ascending: false }).limit(limit)

  const { data, error } = await query
  if (error) throw error
  return NextResponse.json(data)
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const ownerUserId = await requireUserId()
    const { entity } = await params

    switch (entity) {
      case 'search':
        return handleSearch(request, ownerUserId)
      default:
        return handleOrders(request, ownerUserId)
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

    if (entity !== 'orders') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const db = getSupabaseAdmin()
    const { order_id, platform, sku_id, order_date, qty_ordered, qty_delivered, qty_returned, sale_price, status, delivery_date, return_date, customer_location, refund_amount, notes } = body

    assert(order_id && platform && sku_id && order_date, 'Required fields missing.')

    const { data: sku, error: skuError } = await db.from('skus').select('id, cost_per_unit').eq('id', sku_id).eq('owner_user_id', ownerUserId).maybeSingle()
    if (skuError) throw skuError
    if (!sku) throw new Error('SKU not found')

    const { data, error } = await db.from('business_orders').insert({
      owner_user_id: ownerUserId,
      order_id,
      platform,
      sku_id,
      order_date,
      qty_ordered: Math.max(0, Number(qty_ordered ?? 1)),
      qty_delivered: Math.max(0, Number(qty_delivered ?? 0)),
      qty_returned: Math.max(0, Number(qty_returned ?? 0)),
      sale_price: Math.max(0, Number(sale_price ?? 0)),
      status: status || 'Pending',
      delivery_date: delivery_date || null,
      return_date: return_date || null,
      customer_location: body.customer_location || null,
      refund_amount: Math.max(0, Number(body.refund_amount ?? 0)),
      notes: body.notes || null,
    }).select().single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}