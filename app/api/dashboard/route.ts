import { NextResponse } from 'next/server'
import { getSupabaseUser } from '@/lib/supabase-server'

export async function GET() {
  try {
    const supabase = await getSupabaseUser()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get dashboard data
    const [orders, skus, materials, expenses, borrowings, purchases, lowStock] = await Promise.all([
      supabase.from('business_orders')
        .select('*, skus(*)')
        .eq('owner_user_id', user.id)
        .order('order_date', { ascending: false })
        .limit(10),
      supabase.from('skus')
        .select('*')
        .eq('owner_user_id', user.id),
      supabase.from('materials')
        .select('*')
        .eq('owner_user_id', user.id),
      supabase.from('business_expenses')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('expense_date', { ascending: false })
        .limit(10),
      supabase.from('borrowings')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('txn_date', { ascending: false })
        .limit(10),
      supabase.from('material_purchases')
        .select('*, materials(*), suppliers(*)')
        .eq('owner_user_id', user.id)
        .order('purchase_date', { ascending: false })
        .limit(10),
      supabase.from('skus')
        .select('*')
        .eq('owner_user_id', user.id)
        .lte('current_stock', 10) // low stock threshold
    ])

    // Calculate metrics
    const totalRevenue = (orders.data || []).reduce((sum, o) => sum + Number(o.sale_price || 0) * Number(o.qty_delivered || 0), 0)
    const totalExpense = (expenses.data || []).reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const netProfit = totalRevenue - totalExpense
    const totalOrders = orders.data?.length || 0
    const totalDeliveredUnits = (orders.data || []).reduce((sum, o) => sum + Number(o.qty_delivered || 0), 0)
    const totalReturnedUnits = (orders.data || []).reduce((sum, o) => sum + Number(o.qty_returned || 0), 0)
    const totalCogs = (orders.data || []).reduce((sum, o) => sum + Number(o.skus?.cost_per_unit || 0) * Number(o.qty_delivered || 0), 0)
    const grossProfit = totalRevenue - totalCogs
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
    const netProfitMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
    const overallReturnRatePct = totalDeliveredUnits > 0 ? (totalReturnedUnits / totalDeliveredUnits) * 100 : 0

    // SKU margins
    const skuMargins = (skus.data || []).map(sku => {
      const skuOrders = (orders.data || []).filter(o => o.sku_id === sku.id)
      const unitsDelivered = skuOrders.reduce((sum, o) => sum + Number(o.qty_delivered || 0), 0)
      const unitsReturned = skuOrders.reduce((sum, o) => sum + Number(o.qty_returned || 0), 0)
      const revenue = skuOrders.reduce((sum, o) => sum + Number(o.sale_price || 0) * Number(o.qty_delivered || 0), 0)
      const cogs = unitsDelivered * Number(sku.cost_per_unit || 0)
      const grossProfit = revenue - cogs
      const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0
      return {
        sku_id: sku.id,
        productName: sku.product_name,
        skuCode: sku.sku_code,
        platform: sku.platform,
        sellingPrice: sku.selling_price,
        unitCost: sku.cost_per_unit,
        unitsDelivered,
        unitsReturned,
        netRevenue: revenue,
        grossProfit,
        grossMarginPct: Number(marginPct.toFixed(2)),
        tier: marginPct >= 30 ? 'A' : marginPct >= 15 ? 'B' : 'C',
      }
    })

    // Platform breakdown
    const platformMap = new Map()
    for (const order of orders.data || []) {
      const platform = order.platform || 'Unknown'
      const existing = platformMap.get(platform) || { 
        platform, 
        orderCount: 0, 
        netRevenue: 0, 
        grossProfit: 0, 
        totalReturned: 0, 
        totalRefundLoss: 0,
        totalOrders: 0
      }
      existing.orderCount++
      existing.totalOrders++
      existing.netRevenue += Number(order.sale_price || 0) * Number(order.qty_delivered || 0)
      existing.grossProfit += (Number(order.sale_price || 0) - Number(order.skus?.cost_per_unit || 0)) * Number(order.qty_delivered || 0)
      existing.totalReturned += Number(order.qty_returned || 0)
      existing.totalRefundLoss += Number(order.refund_amount || 0)
      platformMap.set(platform, existing)
    }
    const platformBreakdown = Array.from(platformMap.values()).map(p => ({
      ...p,
      grossMarginPct: p.netRevenue > 0 ? Number(((p.grossProfit / p.netRevenue) * 100).toFixed(2)) : 0,
      returnRatePct: p.totalOrders > 0 ? Number((p.totalReturned / p.totalOrders * 100).toFixed(2)) : 0,
      revenueSharePct: 0 // will calculate after
    }))
    const totalNetRevenue = platformBreakdown.reduce((sum, p) => sum + p.netRevenue, 0)
    for (const p of platformBreakdown) {
      p.revenueSharePct = totalNetRevenue > 0 ? Number((p.netRevenue / totalNetRevenue * 100).toFixed(2)) : 0
    }

    // Return analytics
    const returnAnalytics = {
      totalRefundLoss: (orders.data || []).reduce((sum, o) => sum + Number(o.refund_amount || 0), 0),
      topReturnedSkus: (skus.data || []).map(sku => {
        const skuOrders = (orders.data || []).filter(o => o.sku_id === sku.id)
        const unitsReturned = skuOrders.reduce((sum, o) => sum + Number(o.qty_returned || 0), 0)
        const unitsDelivered = skuOrders.reduce((sum, o) => sum + Number(o.qty_delivered || 0), 0)
        const returnRatePct = unitsDelivered > 0 ? (unitsReturned / unitsDelivered) * 100 : 0
        const refundAmount = skuOrders.reduce((sum, o) => sum + Number(o.refund_amount || 0), 0)
        return {
          skuCode: sku.sku_code,
          productName: sku.product_name,
          platform: sku.platform,
          unitsReturned,
          returnRatePct: Number(returnRatePct.toFixed(2)),
          refundAmount,
        }
      }).filter(r => r.unitsReturned > 0).sort((a, b) => b.unitsReturned - a.unitsReturned).slice(0, 10)
    }

    return NextResponse.json({
      skuMargins,
      platformBreakdown,
      kpis: {
        totalOrders,
        totalDeliveredUnits,
        totalReturnedUnits,
        totalGrossRevenue: totalRevenue,
        totalRefundLoss: returnAnalytics.totalRefundLoss,
        totalNetRevenue: totalRevenue - returnAnalytics.totalRefundLoss,
        totalCogs,
        grossProfit,
        grossMarginPct: Number(grossMarginPct.toFixed(2)),
        netProfit,
        netProfitMarginPct: Number(netProfitMarginPct.toFixed(2)),
        overallReturnRatePct: Number(overallReturnRatePct.toFixed(2)),
      },
      skuMargins,
      platformBreakdown,
      returnAnalytics,
      lowStock: (lowStock.data || []).map(s => ({
        ...s,
        stock_value: Number(s.current_stock || 0) * Number(s.cost_per_unit || 0)
      }),
      recentOrders: (orders.data || []).slice(0, 10),
      expenses: expenses.data || [],
      borrowings: borrowings.data || [],
      purchases: purchases.data || [],
      lowStockCount: lowStock.data?.length || 0,
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}