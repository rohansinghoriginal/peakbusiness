import { NextResponse } from 'next/server'

import { ApiError, assert, jsonError, number, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const skuId = new URL(request.url).searchParams.get('skuId') || ''
    assert(skuId, 'A SKU is required.')
    const { data, error } = await getSupabaseAdmin()
      .from('sku_materials')
      .select('id,sku_id,material_id,qty_per_unit,waste_pct,materials!inner(material_code,material_name,unit)')
      .eq('owner_user_id', ownerUserId)
      .eq('sku_id', skuId)
      .order('created_at')
    if (error) throw new ApiError(error.message, 500)
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const skuId = text(body.skuId)
    const lines: unknown[] = Array.isArray(body.lines) ? body.lines as unknown[] : []
    assert(skuId, 'A SKU is required.')
    const db = getSupabaseAdmin()
    const { data: sku, error: skuError } = await db.from('skus').select('id').eq('id', skuId).eq('owner_user_id', ownerUserId).maybeSingle()
    if (skuError) throw skuError
    if (!sku) throw new ApiError('SKU not found.', 404)

    const { error: deleteError } = await db.from('sku_materials').delete().eq('owner_user_id', ownerUserId).eq('sku_id', skuId)
    if (deleteError) throw deleteError
    const values = lines
      .map((line) => line as Record<string, unknown>)
      .map((line: Record<string, unknown>) => ({
        owner_user_id: ownerUserId,
        sku_id: skuId,
        material_id: text(line.materialId),
        qty_per_unit: Math.max(0, number(line.qtyPerUnit)),
        waste_pct: Math.max(0, number(line.wastePct)),
      }))
      .filter((line: { material_id: string; qty_per_unit: number }) => line.material_id && line.qty_per_unit > 0)
    if (values.length) {
      const { error: insertError } = await db.from('sku_materials').insert(values)
      if (insertError) throw insertError
    }
    return NextResponse.json({ ok: true, count: values.length })
  } catch (error) {
    return jsonError(error)
  }
}
