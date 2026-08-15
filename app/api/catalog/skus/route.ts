import { NextResponse } from 'next/server'

import { ApiError, assert, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { ensureSkuMaster, type SkuRecord } from '@/lib/sku-master'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('skus')
      .select()
      .eq('owner_user_id', ownerUserId)
      .order('active', { ascending: false })
      .order('product_name')
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
    const skuCode = text(body.skuCode)
    const productName = text(body.productName)
    assert(skuCode && productName, 'SKU code and product name are required.')

    const platform = text(body.platform) || 'Offline'
    const sellingPrice = Math.max(0, number(body.sellingPrice))
    const { sku } = await ensureSkuMaster({
      db: getSupabaseAdmin(),
      ownerUserId,
      platform,
      skuCode,
      productName,
      salePrice: sellingPrice,
      skuByKey: new Map<string, SkuRecord>(),
      updateExisting: true,
      costPerUnit: Math.max(0, number(body.costPerUnit)),
      openingStock: number(body.openingStock),
      reorderLevel: number(body.reorderLevel),
      category: optionalText(body.category),
      active: body.active !== false,
      notes: optionalText(body.notes),
    })
    const { data, error } = await getSupabaseAdmin()
      .from('skus')
      .select()
      .eq('id', sku.id)
      .eq('owner_user_id', ownerUserId)
      .single()
    if (error) throw new ApiError(error.message, 500)
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
