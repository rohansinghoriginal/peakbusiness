import { NextResponse } from 'next/server'

import { assert, date, jsonError, number, optionalText, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const { data, error } = await getSupabaseAdmin()
      .from('business_expenses')
      .select()
      .eq('owner_user_id', ownerUserId)
      .order('expense_date', { ascending: false })
      .limit(250)
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
    const amount = number(body.amount)
    assert(text(body.category) && amount > 0, 'Category and a positive amount are required.')
    const { data, error } = await getSupabaseAdmin()
      .from('business_expenses')
      .insert({
        owner_user_id: ownerUserId,
        expense_date: date(body.expenseDate),
        category: text(body.category),
        amount,
        description: optionalText(body.description),
        platform: optionalText(body.platform),
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
