import { NextResponse } from 'next/server'

import { ApiError, assert, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('materials')
      .select()
      .eq('owner_user_id', ownerUserId)
      .order('material_name')
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
    const materialCode = text(body.materialCode)
    const materialName = text(body.materialName)
    assert(materialCode && materialName, 'Material code and material name are required.')

    const { data, error } = await getSupabaseAdmin()
      .from('materials')
      .upsert(
        {
          owner_user_id: ownerUserId,
          material_code: materialCode,
          material_name: materialName,
          category: optionalText(body.category),
          unit: text(body.unit) || 'pcs',
          opening_stock: number(body.openingStock),
          reorder_level: number(body.reorderLevel),
          avg_unit_cost: Math.max(0, number(body.avgUnitCost)),
          preferred_vendor: optionalText(body.preferredVendor),
          notes: optionalText(body.notes),
        },
        { onConflict: 'owner_user_id,material_code' },
      )
      .select()
      .single()
    if (error) throw new ApiError(error.message, 500)
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
