import { NextResponse } from 'next/server'

import { ApiError, assert, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin().from('suppliers').select().eq('owner_user_id', ownerUserId).order('supplier_name')
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
    const supplierName = text(body.supplierName)
    assert(supplierName, 'Supplier name is required.')
    const { data, error } = await getSupabaseAdmin()
      .from('suppliers')
      .upsert(
        {
          owner_user_id: ownerUserId,
          supplier_name: supplierName,
          address: optionalText(body.address),
          gstin: optionalText(body.gstin),
          phone: optionalText(body.phone),
          email: optionalText(body.email),
          default_gst_rate: Math.max(0, number(body.defaultGstRate)),
          default_transport_cost: Math.max(0, number(body.defaultTransportCost)),
          notes: optionalText(body.notes),
        },
        { onConflict: 'owner_user_id,supplier_name' },
      )
      .select()
      .single()
    if (error) throw new ApiError(error.message, 500)
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
