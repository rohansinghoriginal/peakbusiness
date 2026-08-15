import { NextResponse } from 'next/server'

import { jsonError, requireUserId } from '@/lib/api'
import { asNumber } from '@/lib/business'
import { getSupabaseAdmin } from '@/lib/supabase-server'

function rowMap(rows: any[]) {
  return new Map(rows.map((row) => [row.id, row]))
}

export async function GET() {
  try {
    const ownerUserId = await requireUserId()
    const db = getSupabaseAdmin()
    const [skusResult, materialsResult, skuTransactionsResult, materialTransactionsResult, ordersResult, expensesResult, borrowingsResult, purchasesResult] =
      await Promise.all([
        db.from('skus').select().eq('owner_user_id', ownerUserId).order('product_name'),
        db.from('materials').select().eq('owner_user_id', ownerUserId).order('material_name'),
        db.from('sku_transactions').select().eq('owner_user_id', ownerUserId),
        db.from('material_transactions').select().eq('owner_user_id', ownerUserId),
        db.from('business_orders').select().eq('owner_user_id', ownerUserId).order('order_date', { ascending: false }).limit(250),
        db.from('business_expenses').select().eq('owner_user_id', ownerUserId).order('expense_date', { ascending: false }).limit(250),
        db.from('borrowings').select().eq('owner_user_id', ownerUserId).order('txn_date', { ascending: false }).limit(100),
        db.from('material_purchases').select().eq('owner_user_id', ownerUserId).order('purchase_date', { ascending: false }).limit(100),
      ])

    const responses = [skusResult, materialsResult, skuTransactionsResult, materialTransactionsResult, ordersResult, expensesResult, borrowingsResult, purchasesResult]
    const firstError = responses.find((response) => response.error)?.error
    if (firstError) throw firstError

    const skus = skusResult.data || []
    const materials = materialsResult.data || []
    const skuMap = rowMap(skus)
    const skuDelta = new Map<string, number>()
    for (const transaction of skuTransactionsResult.data || []) {
      skuDelta.set(transaction.sku_id, (skuDelta.get(transaction.sku_id) || 0) + asNumber(transaction.qty_in) - asNumber(transaction.qty_out))
    }
    const materialDelta = new Map<string, number>()
    for (const transaction of materialTransactionsResult.data || []) {
      materialDelta.set(transaction.material_id, (materialDelta.get(transaction.material_id) || 0) + asNumber(transaction.qty_in) - asNumber(transaction.qty_out))
    }

    const inventory = skus.map((sku) => {
      const currentStock = asNumber(sku.opening_stock) + (skuDelta.get(sku.id) || 0)
      return { ...sku, current_stock: currentStock, stock_value: currentStock * asNumber(sku.cost_per_unit) }
    })
    const materialInventory = materials.map((material) => {
      const currentStock = asNumber(material.opening_stock) + (materialDelta.get(material.id) || 0)
      return { ...material, current_stock: currentStock, stock_value: currentStock * asNumber(material.avg_unit_cost) }
    })
    const orders = (ordersResult.data || []).map((order) => {
      const sku = skuMap.get(order.sku_id)
      const revenue = asNumber(order.qty_ordered) * asNumber(order.sale_price) - asNumber(order.refund_amount)
      const cogs = asNumber(order.qty_delivered) * asNumber(sku?.cost_per_unit)
      return { ...order, sku_code: sku?.sku_code || 'Unknown', product_name: sku?.product_name || 'Unknown product', revenue, cogs, gross_profit: revenue - cogs }
    })
    const revenue = orders.reduce((total, order) => total + asNumber(order.revenue), 0)
    const cogs = orders.reduce((total, order) => total + asNumber(order.cogs), 0)
    const expenses = expensesResult.data || []
    const expenseTotal = expenses.reduce((total, expense) => total + asNumber(expense.amount), 0)
    const lowStockSkus = inventory.filter((sku) => sku.current_stock <= asNumber(sku.reorder_level))
    const lowStockMaterials = materialInventory.filter((material) => material.current_stock <= asNumber(material.reorder_level))
    const borrowings = (borrowingsResult.data || []).map((row) => ({
      ...row,
      outstanding_qty: asNumber(row.qty) - asNumber(row.qty_returned),
      outstanding_value: (asNumber(row.qty) - asNumber(row.qty_returned)) * asNumber(row.unit_cost),
    }))

    return NextResponse.json({
      metrics: {
        revenue,
        cogs,
        grossProfit: revenue - cogs,
        expenses: expenseTotal,
        netProfit: revenue - cogs - expenseTotal,
        unitsDelivered: orders.reduce((total, order) => total + asNumber(order.qty_delivered), 0),
        lowStockCount: lowStockSkus.length + lowStockMaterials.length,
        materialInventoryValue: materialInventory.reduce((total, material) => total + material.stock_value, 0),
      },
      orders: orders.slice(0, 12),
      skus: inventory,
      materials: materialInventory,
      lowStock: [...lowStockSkus.map((item) => ({ ...item, item_type: 'SKU' })), ...lowStockMaterials.map((item) => ({ ...item, item_type: 'Material' }))].slice(0, 8),
      expenses,
      borrowings,
      purchases: purchasesResult.data || [],
    })
  } catch (error) {
    return jsonError(error)
  }
}
