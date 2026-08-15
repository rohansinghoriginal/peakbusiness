import { NextResponse } from 'next/server'

import { jsonError, requireUserId } from '@/lib/api'
import { saveOrderWithLedger } from '@/lib/order-ledger'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const db = getSupabaseAdmin()
    const { data: orders, error } = await db
      .from('business_orders')
      .select()
      .eq('owner_user_id', ownerUserId)
      .order('order_date', { ascending: false })
      .limit(250)
    if (error) throw error
    const { data: skus, error: skuError } = await db.from('skus').select('id,sku_code,product_name,cost_per_unit').eq('owner_user_id', ownerUserId)
    if (skuError) throw skuError
    const skuMap = new Map((skus || []).map((sku) => [sku.id, sku]))
    return NextResponse.json(
      (orders || []).map((order) => ({
        ...order,
        sku_code: skuMap.get(order.sku_id)?.sku_code || 'Unknown',
        product_name: skuMap.get(order.sku_id)?.product_name || 'Unknown product',
      })),
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const order = await saveOrderWithLedger({
      db: getSupabaseAdmin(),
      ownerUserId,
      input: await request.json(),
      source: 'MANUAL_ORDER',
    })
    return NextResponse.json(order)
  } catch (error) {
    return jsonError(error)
  }
}
