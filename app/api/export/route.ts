import { NextResponse } from 'next/server'

import { jsonError, requireUserId } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

const datasets: Record<string, string> = {
  orders: 'business_orders',
  skus: 'skus',
  materials: 'materials',
  sku_materials: 'sku_materials',
  material_transactions: 'material_transactions',
  sku_transactions: 'sku_transactions',
  borrowings: 'borrowings',
  expenses: 'business_expenses',
  suppliers: 'suppliers',
  purchases: 'material_purchases',
  import_history: 'sales_import_batches',
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const requested = Array.isArray(body.datasets) ? body.datasets.filter((key: unknown) => typeof key === 'string' && datasets[key]) : Object.keys(datasets)
    const db = getSupabaseAdmin()
    const result: Record<string, unknown[]> = {}
    await Promise.all(
      requested.map(async (key: string) => {
        const { data, error } = await db.from(datasets[key]).select().eq('owner_user_id', ownerUserId)
        if (error) throw error
        result[key] = data || []
      }),
    )
    return NextResponse.json({ generatedAt: new Date().toISOString(), datasets: result })
  } catch (error) {
    return jsonError(error)
  }
}
