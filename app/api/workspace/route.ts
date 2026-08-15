import { NextResponse } from 'next/server'

import { jsonError, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

async function getWorkspace(ownerUserId: string) {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('app_workspaces')
    .upsert({ owner_user_id: ownerUserId }, { onConflict: 'owner_user_id', ignoreDuplicates: true })
    .select()
    .single()

  if (data) return data
  if (error && error.code !== 'PGRST116') throw error

  const { data: existing, error: existingError } = await db
    .from('app_workspaces')
    .select()
    .eq('owner_user_id', ownerUserId)
    .single()
  if (existingError) throw existingError
  return existing
}

export async function GET() {
  try {
    return NextResponse.json(await getWorkspace(await requireUserId()))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const db = getSupabaseAdmin()
    const { data, error } = await db
      .from('app_workspaces')
      .upsert(
        {
          owner_user_id: ownerUserId,
          business_name: text(body.businessName) || 'My business',
          default_currency: optionalText(body.defaultCurrency) || 'INR',
        },
        { onConflict: 'owner_user_id' },
      )
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
