import { NextResponse } from 'next/server'

import { jsonError, requireUserId } from '@/lib/api'
import { asNumber } from '@/lib/business'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function GET(request: Request) {
  try {
    const ownerUserId = await requireUserId()
    const url = new URL(request.url)
    const timeWindow = url.searchParams.get('range') || 'all' // 'all' | '30d' | '7d' | 'month'
    const useMaterialized = url.searchParams.get('mv') !== 'false' // default to materialized views

    const db = getSupabaseAdmin()

    if (useMaterialized && timeWindow === 'all') {
      // Use materialized views for full-range queries (fastest)
      const [skuMv, platformMv, kpiMv] = await Promise.all([
        db.from('mv_sku_metrics').select('*').eq('owner_user_id', ownerUserId),
        db.from('mv_platform_metrics').select('*').eq('owner_user_id', ownerUserId),
        db.from('mv_overall_kpis').select('*').eq('owner_user_id', ownerUserId).maybeSingle(),
      ])

      if (skuMv.error) throw skuMv.error
      if (platformMv.error) throw platformMv.error
      if (kpiMv.error) throw kpiMv.error

      const skuMargins = (skuMv.data || []).map((item) => ({
        ...item,
        grossMarginPct: Number(item.gross_margin_pct),
        returnRatePct: Number(item.return_rate_pct),
        tier: item.tier,
      }))

      const platformBreakdown = (platformMv.data || []).map((p) => ({
        ...p,
        grossMarginPct: Number(p.gross_margin_pct),
        returnRatePct: Number(p.return_rate_pct),
        revenueSharePct: Number(p.revenue_share_pct),
      }))

      const kpis = kpiMv.data ? {
        totalOrders: Number(kpiMv.data.total_orders),
        totalDeliveredUnits: Number(kpiMv.data.total_delivered_units),
        totalReturnedUnits: Number(kpiMv.data.total_returned_units),
        totalGrossRevenue: Number(kpiMv.data.total_gross_revenue),
        totalRefundLoss: Number(kpiMv.data.total_refund_loss),
        totalNetRevenue: Number(kpiMv.data.total_net_revenue),
        totalCogs: Number(kpiMv.data.total_cogs),
        grossProfit: Number(kpiMv.data.gross_profit),
        grossMarginPct: Number(kpiMv.data.gross_margin_pct),
        totalExpenses: Number(kpiMv.data.total_expenses),
        netProfit: Number(kpiMv.data.net_profit),
        netProfitMarginPct: Number(kpiMv.data.net_profit_margin_pct),
        overallReturnRatePct: Number(kpiMv.data.overall_return_rate_pct),
      } : {
        totalOrders: 0,
        totalDeliveredUnits: 0,
        totalReturnedUnits: 0,
        totalGrossRevenue: 0,
        totalRefundLoss: 0,
        totalNetRevenue: 0,
        totalCogs: 0,
        grossProfit: 0,
        grossMarginPct: 0,
        totalExpenses: 0,
        netProfit: 0,
        netProfitMarginPct: 0,
        overallReturnRatePct: 0,
      }

      return NextResponse.json({
        timeWindow,
        kpis,
        skuMargins: skuMargins.sort((a, b) => b.grossProfit - a.grossProfit),
        platforms: platformBreakdown.sort((a, b) => b.netRevenue - a.netRevenue),
        returnAnalytics: {
          overallReturnRatePct: kpis.overallReturnRatePct,
          totalRefundLoss: kpis.totalRefundLoss,
          totalReturnedUnits: kpis.totalReturnedUnits,
          topReturnedSkus: skuMargins
            .filter((s) => s.unitsReturned > 0)
            .sort((a, b) => b.unitsReturned - a.unitsReturned)
            .slice(0, 5),
          platforms: platformBreakdown.map((p) => ({
            platform: p.platform,
            returnedUnits: p.unitsReturned,
            returnRatePct: p.returnRatePct,
            refundAmount: p.refundAmount,
          })),
        },
        meta: {
          source: 'materialized_view',
          refreshedAt: skuMv.data[0]?.refreshed_at,
        },
      })
    }

    // Fallback: compute on-demand for time-windowed queries
    const [skusRes, ordersRes, expensesRes, bomRes] = await Promise.all([
      db.from('skus').select().eq('owner_user_id', ownerUserId),
      db.from('business_orders').select().eq('owner_user_id', ownerUserId).order('order_date', { ascending: false }),
      db.from('business_expenses').select().eq('owner_user_id', ownerUserId),
      db.from('sku_materials').select('sku_id, qty_per_unit, waste_pct, materials(avg_unit_cost)').eq('owner_user_id', ownerUserId),
    ])

    if (skusRes.error) throw skusRes.error
    if (ordersRes.error) throw ordersRes.error
    if (expensesRes.error) throw expensesRes.error

    const skus = skusRes.data || []
    let allOrders = ordersRes.data || []
    let allExpenses = expensesRes.data || []

    // Calculate BOM cost for each SKU if present
    const bomCostMap = new Map<string, number>()
    for (const link of bomRes.data || []) {
      const material = Array.isArray(link.materials) ? link.materials[0] : link.materials
      const matUnitCost = asNumber(material?.avg_unit_cost)
      const qty = asNumber(link.qty_per_unit)
      const waste = asNumber(link.waste_pct) / 100
      const cost = qty * matUnitCost * (1 + waste)
      bomCostMap.set(link.sku_id, (bomCostMap.get(link.sku_id) || 0) + cost)
    }

    // Apply date filtering
    const now = new Date()
    let startDate: string | null = null
    if (timeWindow === '7d') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      startDate = d.toISOString().slice(0, 10)
    } else if (timeWindow === '30d') {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      startDate = d.toISOString().slice(0, 10)
    } else if (timeWindow === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      startDate = d.toISOString().slice(0, 10)
    }

    if (startDate) {
      allOrders = allOrders.filter((o) => (o.order_date || '') >= startDate!)
      allExpenses = allExpenses.filter((e) => (e.expense_date || '') >= startDate!)
    }

    // 1. SKU Map & Orders Aggregation
    const skuMap = new Map(skus.map((s) => [s.id, s]))
    const skuMetrics = new Map<
      string,
      {
        skuId: string
        skuCode: string
        productName: string
        platform: string
        sellingPrice: number
        unitCost: number
        unitsOrdered: number
        unitsDelivered: number
        unitsReturned: number
        grossRevenue: number
        refundAmount: number
        netRevenue: number
        cogs: number
        grossProfit: number
      }
    >()

    for (const sku of skus) {
      const bomCost = bomCostMap.get(sku.id)
      const effectiveCost = bomCost && bomCost > 0 ? bomCost : asNumber(sku.cost_per_unit)
      skuMetrics.set(sku.id, {
        skuId: sku.id,
        skuCode: sku.sku_code,
        productName: sku.product_name,
        platform: sku.platform,
        sellingPrice: asNumber(sku.selling_price),
        unitCost: effectiveCost,
        unitsOrdered: 0,
        unitsDelivered: 0,
        unitsReturned: 0,
        grossRevenue: 0,
        refundAmount: 0,
        netRevenue: 0,
        cogs: 0,
        grossProfit: 0,
      })
    }

    // 2. Platform Map Aggregation
    const platformMetrics = new Map<
      string,
      {
        platform: string
        orderCount: number
        unitsOrdered: number
        unitsDelivered: number
        unitsReturned: number
        grossRevenue: number
        refundAmount: number
        netRevenue: number
        cogs: number
        grossProfit: number
      }
    >()

    let totalDeliveredUnits = 0
    let totalReturnedUnits = 0
    let totalGrossRevenue = 0
    let totalRefundLoss = 0
    let totalNetRevenue = 0
    let totalCogs = 0

    for (const order of allOrders) {
      const sku = skuMap.get(order.sku_id)
      const skuId = order.sku_id
      const platform = order.platform || sku?.platform || 'Offline'

      const ordered = asNumber(order.qty_ordered)
      const delivered = asNumber(order.qty_delivered)
      const returned = asNumber(order.qty_returned)
      const salePrice = asNumber(order.sale_price)
      const refund = asNumber(order.refund_amount)

      const gross = ordered * salePrice
      const net = delivered * salePrice - refund
      const bomCost = bomCostMap.get(skuId)
      const unitCost = bomCost && bomCost > 0 ? bomCost : asNumber(sku?.cost_per_unit)
      const cogs = delivered * unitCost
      const profit = net - cogs

      totalDeliveredUnits += delivered
      totalReturnedUnits += returned
      totalGrossRevenue += gross
      totalRefundLoss += refund
      totalNetRevenue += net
      totalCogs += cogs

      // Aggregate SKU metrics
      let sm = skuMetrics.get(skuId)
      if (!sm && sku) {
        sm = {
          skuId,
          skuCode: sku.sku_code,
          productName: sku.product_name,
          platform: sku.platform,
          sellingPrice: asNumber(sku.selling_price),
          unitCost,
          unitsOrdered: 0,
          unitsDelivered: 0,
          unitsReturned: 0,
          grossRevenue: 0,
          refundAmount: 0,
          netRevenue: 0,
          cogs: 0,
          grossProfit: 0,
        }
        skuMetrics.set(skuId, sm)
      }
      if (sm) {
        sm.unitsOrdered += ordered
        sm.unitsDelivered += delivered
        sm.unitsReturned += returned
        sm.grossRevenue += gross
        sm.refundAmount += refund
        sm.netRevenue += net
        sm.cogs += cogs
        sm.grossProfit += profit
      }

      // Aggregate Platform metrics
      let pm = platformMetrics.get(platform)
      if (!pm) {
        pm = {
          platform,
          orderCount: 0,
          unitsOrdered: 0,
          unitsDelivered: 0,
          unitsReturned: 0,
          grossRevenue: 0,
          refundAmount: 0,
          netRevenue: 0,
          cogs: 0,
          grossProfit: 0,
        }
        platformMetrics.set(platform, pm)
      }
      pm.orderCount += 1
      pm.unitsOrdered += ordered
      pm.unitsDelivered += delivered
      pm.unitsReturned += returned
      pm.grossRevenue += gross
      pm.refundAmount += refund
      pm.netRevenue += net
      pm.cogs += cogs
      pm.grossProfit += profit
    }

    // SKU Margins Table items
    const skuMarginTable = Array.from(skuMetrics.values()).map((item) => {
      const marginPct = item.netRevenue > 0 ? (item.grossProfit / item.netRevenue) * 100 : 0
      const totalUnits = item.unitsDelivered + item.unitsReturned
      const returnRate = totalUnits > 0 ? (item.unitsReturned / totalUnits) * 100 : 0
      let tier: 'high' | 'healthy' | 'low' | 'loss' = 'healthy'
      if (item.grossProfit < 0) tier = 'loss'
      else if (marginPct >= 40) tier = 'high'
      else if (marginPct < 20) tier = 'low'

      return {
        ...item,
        grossMarginPct: Math.round(marginPct * 10) / 10,
        returnRatePct: Math.round(returnRate * 10) / 10,
        tier,
      }
    })

    skuMarginTable.sort((a, b) => b.grossProfit - a.grossProfit)

    // Platform Breakdown table items
    const platformBreakdown = Array.from(platformMetrics.values()).map((p) => {
      const marginPct = p.netRevenue > 0 ? (p.grossProfit / p.netRevenue) * 100 : 0
      const totalUnits = p.unitsDelivered + p.unitsReturned
      const returnRate = totalUnits > 0 ? (p.unitsReturned / totalUnits) * 100 : 0
      const revenueSharePct = totalNetRevenue > 0 ? (p.netRevenue / totalNetRevenue) * 100 : 0

      return {
        ...p,
        grossMarginPct: Math.round(marginPct * 10) / 10,
        returnRatePct: Math.round(returnRate * 10) / 10,
        revenueSharePct: Math.round(revenueSharePct * 10) / 10,
      }
    })

    platformBreakdown.sort((a, b) => b.netRevenue - a.netRevenue)

    // Return rate analytics
    const totalHandledUnits = totalDeliveredUnits + totalReturnedUnits
    const overallReturnRatePct =
      totalHandledUnits > 0 ? Math.round((totalReturnedUnits / totalHandledUnits) * 1000) / 10 : 0

    const topReturnedSkus = [...skuMarginTable]
      .filter((s) => s.unitsReturned > 0)
      .sort((a, b) => b.unitsReturned - a.unitsReturned)
      .slice(0, 5)

    const totalExpenses = allExpenses.reduce((sum, exp) => sum + asNumber(exp.amount), 0)
    const grossProfit = totalNetRevenue - totalCogs
    const netProfit = grossProfit - totalExpenses
    const grossMarginPct = totalNetRevenue > 0 ? Math.round((grossProfit / totalNetRevenue) * 1000) / 10 : 0
    const netProfitMarginPct = totalNetRevenue > 0 ? Math.round((netProfit / totalNetRevenue) * 1000) / 10 : 0

    return NextResponse.json({
      timeWindow,
      kpis: {
        totalOrders: allOrders.length,
        totalDeliveredUnits,
        totalReturnedUnits,
        totalGrossRevenue,
        totalRefundLoss,
        totalNetRevenue,
        totalCogs,
        grossProfit,
        grossMarginPct,
        totalExpenses,
        netProfit,
        netProfitMarginPct,
        overallReturnRatePct,
      },
      skuMargins: skuMarginTable,
      platforms: platformBreakdown,
      returnAnalytics: {
        overallReturnRatePct,
        totalRefundLoss,
        totalReturnedUnits,
        topReturnedSkus,
        platforms: platformBreakdown.map((p) => ({
          platform: p.platform,
          returnedUnits: p.unitsReturned,
          returnRatePct: p.returnRatePct,
          refundAmount: p.refundAmount,
        })),
      },
      meta: {
        source: 'computed_on_demand',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}