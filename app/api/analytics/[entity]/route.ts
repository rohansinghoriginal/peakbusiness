import { NextResponse } from 'next/server'

import { jsonError, requireUserId } from '@/lib/api'
import { asNumber } from '@/lib/business'
import { getSupabaseAdmin } from '@/lib/supabase-server'

async function handleHealth(request: Request) {
  return NextResponse.json({ ok: true, service: 'peak-business', timestamp: new Date().toISOString() })
}

async function handleAnalytics(request: Request, ownerUserId: string) {
  try {
    const { searchParams } = new URL(request.url)
    const timeWindow = searchParams.get('range') || 'all'
    const useMaterialized = searchParams.get('mv') !== 'false'

    const db = getSupabaseAdmin()

    if (useMaterialized && timeWindow === 'all') {
      const [skuMv, platformMv, kpiMv] = await Promise.all([
        db.from('mv_sku_metrics').select('*').eq('owner_user_id', ownerUserId),
        db.from('mv_platform_metrics').select('*').eq('owner_user_id', ownerUserId),
        db.from('mv_overall_kpis').select('*').eq('owner_user_id', ownerUserId).maybeSingle(),
      ])

      if (skuMv.error) throw skuMv.error
      if (platformMv.error) throw platformMv.error
      if (kpiMv.error) throw kpiMv.error

      return NextResponse.json({
        skuMargins: (skuMv.data || []).map((item) => ({
          ...item,
          grossMarginPct: Number(item.gross_margin_pct),
          returnRatePct: Number(item.return_rate_pct),
          tier: item.tier,
        })),
        platformBreakdown: (platformMv.data || []).map((p) => ({
          ...p,
          grossMarginPct: Number(p.gross_margin_pct),
          returnRatePct: Number(p.return_rate_pct),
          revenueSharePct: Number(p.revenue_share_pct),
        })),
        kpis: kpiMv.data ? {
          totalOrders: Number(kpiMv.data.total_orders),
          totalDeliveredUnits: Number(kpiMv.data.total_delivered_units),
          totalReturnedUnits: Number(kpiMv.data.total_returned_units),
          totalGrossRevenue: Number(kpiMv.data.total_gross_revenue),
          totalRefundLoss: Number(kpiMv.data.total_refund_loss),
          totalNetRevenue: Number(kpiMv.data.total_net_revenue),
          totalCogs: Number(kpiMv.data.total_cogs),
          grossProfit: Number(kpiMv.data.gross_profit),
          grossMarginPct: Number(kpiMv.data.gross_margin_pct),
        } : null,
      })
    }

    const db2 = getSupabaseAdmin()
    const cutoff = timeWindow !== 'all' ? new Date(Date.now() - (timeWindow === '30d' ? 30 : 7) * 24 * 60 * 60 * 1000).toISOString() : null

    let query = db2.from('business_orders').select('*, skus(cost_per_unit)').eq('owner_user_id', ownerUserId)
    if (cutoff) query = query.gte('order_date', cutoff)

    const { data: orders, error } = await query
    if (error) throw error

    const skuMap = new Map<string, { revenue: number; cogs: number; units: number; returns: number; orders: number; margin: number }>()
    let totalOrders = 0, totalDelivered = 0, totalReturned = 0, totalRevenue = 0, totalRefund = 0, totalCogs = 0

    for (const o of orders || []) {
      const sku = o.skus
      if (!sku) continue

      const delivered = Number(o.qty_delivered ?? 0)
      const returned = Number(o.qty_returned ?? 0)
      const salePrice = Number(o.sale_price ?? 0)
      const cost = Number(sku.cost_per_unit ?? 0)

      totalOrders++
      totalDelivered += delivered
      totalReturned += returned
      totalRevenue += delivered * salePrice
      totalRefund += returned * salePrice
      totalCogs += (delivered + returned) * cost

      const key = o.sku_id
      const existing = skuMap.get(key) || { revenue: 0, cogs: 0, units: 0, returns: 0, orders: 0, margin: 0 }
      existing.revenue += delivered * salePrice
      existing.cogs += (delivered + returned) * cost
      existing.units += delivered
      existing.returns += returned
      existing.orders += 1
      existing.margin = existing.revenue > 0 ? (existing.revenue - existing.cogs) / existing.revenue * 100 : 0
      skuMap.set(key, existing)
    }

    const skuMargins = Array.from(skuMap.entries()).map(([skuId, m]) => ({
      sku_id: skuId,
      grossMarginPct: Number(m.margin.toFixed(2)),
      returnRatePct: m.units > 0 ? Number((m.returns / m.units * 100).toFixed(2)) : 0,
      tier: m.margin >= 30 ? 'A' : m.margin >= 15 ? 'B' : 'C',
    }))

    return NextResponse.json({
      skuMargins,
      platformBreakdown: [],
      kpis: {
        totalOrders,
        totalDeliveredUnits: totalDelivered,
        totalReturnedUnits: totalReturned,
        totalGrossRevenue: totalRevenue,
        totalRefundLoss: totalRefund,
        totalNetRevenue: totalRevenue - totalRefund,
        totalCogs,
        grossProfit: totalRevenue - totalRefund - totalCogs,
        grossMarginPct: totalRevenue > 0 ? Number(((totalRevenue - totalRefund - totalCogs) / totalRevenue * 100).toFixed(2)) : 0,
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

async function handleDashboard(request: Request, ownerUserId: string) {
  try {
    const db = getSupabaseAdmin()
    const [orders, expenses, borrowings, skus] = await Promise.all([
      db.from('business_orders').select('order_date, sale_price, qty_delivered, status').eq('owner_user_id', ownerUserId),
      db.from('business_expenses').select('expense_date, amount, category').eq('owner_user_id', ownerUserId),
      db.from('borrowings').select('txn_date, direction, counterparty, item_name, quantity, unit_cost, settlement_status').eq('owner_user_id', ownerUserId),
      db.from('skus').select('sku_code, product_name, selling_price, opening_stock, reorder_level, active').eq('owner_user_id', ownerUserId),
    ])

    const recentOrders = (orders.data || []).slice(-10).reverse()
    const lowStock = (skus.data || []).filter(s => s.active && Number(s.opening_stock) <= Number(s.reorder_level))
    const totalExpense = (expenses.data || []).reduce((sum, e) => sum + Number(e.amount), 0)
    const totalRevenue = (orders.data || []).reduce((sum, o) => sum + Number(o.sale_price) * Number(o.qty_delivered), 0)

    return NextResponse.json({
      recentOrders,
      lowStock,
      summary: {
        totalRevenue,
        totalExpense,
        netProfit: totalRevenue - totalExpense,
        openBorrowings: (borrowings.data || []).filter(b => b.direction === 'borrowed' && b.settlement_status !== 'Settled').length,
        totalSkus: skus.data?.length ?? 0,
        lowStockCount: lowStock.length,
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const { entity } = await params
    if (entity === 'health') return handleHealth(request)

    const ownerUserId = await requireUserId()

    switch (entity) {
      case 'dashboard':
        return handleDashboard(request, ownerUserId)
      default:
        return handleAnalytics(request, ownerUserId)
    }
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  try {
    const { entity } = await params
    if (entity === 'health') return handleHealth(request)

    const ownerUserId = await requireUserId()

    switch (entity) {
      case 'dashboard':
        return handleDashboard(request, ownerUserId)
      default:
        return handleAnalytics(request, ownerUserId)
    }
  } catch (error) {
    return jsonError(error)
  }
}