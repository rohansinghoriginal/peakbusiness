import { NextResponse } from 'next/server'

import { ApiError, assert, jsonError, requireUserId, text } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase-server'

const confirmationPhrases: Record<string, string> = {
  orders: 'DELETE ORDERS',
  skus: 'DELETE SKUS',
  materials: 'DELETE MATERIALS',
  purchases: 'DELETE PURCHASES',
  suppliers: 'DELETE SUPPLIERS',
  borrowings: 'DELETE BORROWINGS',
  expenses: 'DELETE EXPENSES',
  import_history: 'DELETE IMPORT HISTORY',
  all: 'DELETE EVERYTHING',
}

async function deleteMatching(db: any, table: string, ownerUserId: string) {
  const { error } = await db.from(table).delete().eq('owner_user_id', ownerUserId)
  if (error) throw error
}

export async function DELETE(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const body = await request.json()
    const scope = text(body.scope)
    const expected = confirmationPhrases[scope]
    assert(expected, 'Unknown deletion target.')
    assert(text(body.confirmation) === expected, `Type ${expected} to confirm this deletion.`)
    const db = getSupabaseAdmin()

    const dependencies: Record<string, string[]> = {
      orders: ['material_transactions', 'sku_transactions', 'business_orders'],
      skus: ['material_transactions', 'sku_transactions', 'sku_materials', 'business_orders', 'skus'],
      materials: ['material_transactions', 'material_purchases', 'sku_materials', 'materials'],
      purchases: ['material_transactions', 'material_purchases'],
      suppliers: ['material_purchases', 'suppliers'],
      borrowings: ['borrowings'],
      expenses: ['business_expenses'],
      import_history: ['sales_import_batches'],
      all: [
        'material_transactions',
        'sku_transactions',
        'business_orders',
        'material_purchases',
        'sku_materials',
        'borrowings',
        'business_expenses',
        'suppliers',
        'materials',
        'skus',
        'sales_import_batches',
        'app_workspaces',
      ],
    }

    for (const table of dependencies[scope]) await deleteMatching(db, table, ownerUserId)
    return NextResponse.json({ ok: true, scope })
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error)
    return jsonError(error)
  }
}
