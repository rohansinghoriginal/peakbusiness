-- Materialized Views for Analytics Performance
-- Refresh hourly via pg_cron or manually via /api/analytics/reconcile

-- ============================================================
-- 1. SKU Metrics Materialized View
-- ============================================================
create materialized view if not exists public.mv_sku_metrics as
with sku_costs as (
  select
    s.id as sku_id,
    s.owner_user_id,
    s.sku_code,
    s.product_name,
    s.platform,
    s.selling_price,
    coalesce(
      (select sum(qty_per_unit * m.avg_unit_cost * (1 + waste_pct / 100))
       from public.sku_materials sm
       join public.materials m on m.id = sm.material_id
       where sm.owner_user_id = s.owner_user_id and sm.sku_id = s.id),
      s.cost_per_unit
    ) as unit_cost
  from public.skus s
),
order_aggregates as (
  select
    o.owner_user_id,
    o.sku_id,
    o.platform,
    sum(o.qty_ordered) as units_ordered,
    sum(o.qty_delivered) as units_delivered,
    sum(o.qty_returned) as units_returned,
    sum(o.qty_ordered * o.sale_price) as gross_revenue,
    sum(o.refund_amount) as refund_amount,
    sum(o.qty_delivered * o.sale_price - o.refund_amount) as net_revenue,
    sum(o.qty_delivered * sc.unit_cost) as cogs,
    sum(o.qty_delivered * o.sale_price - o.refund_amount - o.qty_delivered * sc.unit_cost) as gross_profit
  from public.business_orders o
  join sku_costs sc on sc.sku_id = o.sku_id and sc.owner_user_id = o.owner_user_id
  where o.entity_type = 'order'
  group by o.owner_user_id, o.sku_id, o.platform
),
return_aggregates as (
  select
    o.owner_user_id,
    o.sku_id,
    sum(o.qty_returned) as returned_qty,
    sum(o.refund_amount) as return_refund
  from public.business_orders o
  where o.entity_type = 'return'
  group by o.owner_user_id, o.sku_id
)
select
  sc.owner_user_id,
  sc.sku_id,
  sc.sku_code,
  sc.product_name,
  sc.platform,
  sc.selling_price,
  sc.unit_cost,
  coalesce(oa.units_ordered, 0) as units_ordered,
  coalesce(oa.units_delivered, 0) as units_delivered,
  coalesce(oa.units_returned, 0) + coalesce(ra.returned_qty, 0) as units_returned,
  coalesce(oa.gross_revenue, 0) as gross_revenue,
  coalesce(oa.refund_amount, 0) + coalesce(ra.return_refund, 0) as refund_amount,
  coalesce(oa.net_revenue, 0) as net_revenue,
  coalesce(oa.cogs, 0) as cogs,
  coalesce(oa.gross_profit, 0) as gross_profit,
  case
    when coalesce(oa.net_revenue, 0) > 0 then round((coalesce(oa.gross_profit, 0) / oa.net_revenue) * 1000) / 10
    else 0
  end as gross_margin_pct,
  case
    when (coalesce(oa.units_delivered, 0) + coalesce(oa.units_returned, 0) + coalesce(ra.returned_qty, 0)) > 0
    then round(((coalesce(oa.units_returned, 0) + coalesce(ra.returned_qty, 0))::numeric / 
      (coalesce(oa.units_delivered, 0) + coalesce(oa.units_returned, 0) + coalesce(ra.returned_qty, 0))) * 1000) / 10
    else 0
  end as return_rate_pct,
  case
    when coalesce(oa.gross_profit, 0) < 0 then 'loss'
    when coalesce(oa.net_revenue, 0) > 0 and (coalesce(oa.gross_profit, 0) / oa.net_revenue) >= 0.4 then 'high'
    when coalesce(oa.net_revenue, 0) > 0 and (coalesce(oa.gross_profit, 0) / oa.net_revenue) < 0.2 then 'low'
    else 'healthy'
  end as tier,
  timezone('utc', now()) as refreshed_at
from sku_costs sc
left join order_aggregates oa on oa.sku_id = sc.sku_id and oa.owner_user_id = sc.owner_user_id
left join return_aggregates ra on ra.sku_id = sc.sku_id and ra.owner_user_id = sc.owner_user_id;

create unique index if not exists mv_sku_metrics_pk on public.mv_sku_metrics (owner_user_id, sku_id);
create index if not exists mv_sku_metrics_owner_platform on public.mv_sku_metrics (owner_user_id, platform);

-- ============================================================
-- 2. Platform Metrics Materialized View
-- ============================================================
create materialized view if not exists public.mv_platform_metrics as
with sku_costs as (
  select
    s.id as sku_id,
    s.owner_user_id,
    s.platform,
    coalesce(
      (select sum(qty_per_unit * m.avg_unit_cost * (1 + waste_pct / 100))
       from public.sku_materials sm
       join public.materials m on m.id = sm.material_id
       where sm.owner_user_id = s.owner_user_id and sm.sku_id = s.id),
      s.cost_per_unit
    ) as unit_cost
  from public.skus s
),
order_aggregates as (
  select
    o.owner_user_id,
    o.platform,
    count(*) as order_count,
    sum(o.qty_ordered) as units_ordered,
    sum(o.qty_delivered) as units_delivered,
    sum(o.qty_returned) as units_returned,
    sum(o.qty_ordered * o.sale_price) as gross_revenue,
    sum(o.refund_amount) as refund_amount,
    sum(o.qty_delivered * o.sale_price - o.refund_amount) as net_revenue,
    sum(o.qty_delivered * sc.unit_cost) as cogs,
    sum(o.qty_delivered * o.sale_price - o.refund_amount - o.qty_delivered * sc.unit_cost) as gross_profit
  from public.business_orders o
  join sku_costs sc on sc.sku_id = o.sku_id and sc.owner_user_id = o.owner_user_id
  where o.entity_type = 'order'
  group by o.owner_user_id, o.platform
),
return_aggregates as (
  select
    o.owner_user_id,
    o.platform,
    sum(o.qty_returned) as returned_qty,
    sum(o.refund_amount) as return_refund
  from public.business_orders o
  where o.entity_type = 'return'
  group by o.owner_user_id, o.platform
),
expense_aggregates as (
  select
    e.owner_user_id,
    coalesce(e.platform, 'All') as platform,
    sum(e.amount) as total_expenses
  from public.business_expenses e
  group by e.owner_user_id, e.platform
)
select
  oa.owner_user_id,
  oa.platform,
  oa.order_count,
  oa.units_ordered,
  oa.units_delivered,
  oa.units_returned + coalesce(ra.returned_qty, 0) as units_returned,
  oa.gross_revenue,
  oa.refund_amount + coalesce(ra.return_refund, 0) as refund_amount,
  oa.net_revenue,
  oa.cogs,
  oa.gross_profit,
  case
    when oa.net_revenue > 0 then round((oa.gross_profit / oa.net_revenue) * 1000) / 10
    else 0
  end as gross_margin_pct,
  case
    when (oa.units_delivered + oa.units_returned + coalesce(ra.returned_qty, 0)) > 0
    then round(((oa.units_returned + coalesce(ra.returned_qty, 0))::numeric / 
      (oa.units_delivered + oa.units_returned + coalesce(ra.returned_qty, 0))) * 1000) / 10
    else 0
  end as return_rate_pct,
  coalesce(ea.total_expenses, 0) as total_expenses,
  oa.gross_profit - coalesce(ea.total_expenses, 0) as net_profit,
  case
    when oa.net_revenue > 0 then round(((oa.gross_profit - coalesce(ea.total_expenses, 0)) / oa.net_revenue) * 1000) / 10
    else 0
  end as net_profit_margin_pct,
  timezone('utc', now()) as refreshed_at
from order_aggregates oa
left join return_aggregates ra on ra.owner_user_id = oa.owner_user_id and ra.platform = oa.platform
left join expense_aggregates ea on ea.owner_user_id = oa.owner_user_id and ea.platform = oa.platform;

create unique index if not exists mv_platform_metrics_pk on public.mv_platform_metrics (owner_user_id, platform);

-- ============================================================
-- 3. Overall KPIs Materialized View
-- ============================================================
create materialized view if not exists public.mv_overall_kpis as
with sku_costs as (
  select
    s.id as sku_id,
    s.owner_user_id,
    coalesce(
      (select sum(qty_per_unit * m.avg_unit_cost * (1 + waste_pct / 100))
       from public.sku_materials sm
       join public.materials m on m.id = sm.material_id
       where sm.owner_user_id = s.owner_user_id and sm.sku_id = s.id),
      s.cost_per_unit
    ) as unit_cost
  from public.skus s
),
order_aggregates as (
  select
    o.owner_user_id,
    count(*) as total_orders,
    sum(o.qty_delivered) as total_delivered_units,
    sum(o.qty_returned) as total_returned_units,
    sum(o.qty_ordered * o.sale_price) as total_gross_revenue,
    sum(o.refund_amount) as total_refund_loss,
    sum(o.qty_delivered * o.sale_price - o.refund_amount) as total_net_revenue,
    sum(o.qty_delivered * sc.unit_cost) as total_cogs,
    sum(o.qty_delivered * o.sale_price - o.refund_amount - o.qty_delivered * sc.unit_cost) as gross_profit
  from public.business_orders o
  join sku_costs sc on sc.sku_id = o.sku_id and sc.owner_user_id = o.owner_user_id
  where o.entity_type = 'order'
  group by o.owner_user_id
),
return_aggregates as (
  select
    o.owner_user_id,
    sum(o.qty_returned) as total_returned_units,
    sum(o.refund_amount) as total_refund_loss
  from public.business_orders o
  where o.entity_type = 'return'
  group by o.owner_user_id
),
expense_aggregates as (
  select
    e.owner_user_id,
    sum(e.amount) as total_expenses
  from public.business_expenses e
  group by e.owner_user_id
)
select
  oa.owner_user_id,
  oa.total_orders,
  oa.total_delivered_units,
  oa.total_returned_units + coalesce(ra.total_returned_units, 0) as total_returned_units,
  oa.total_gross_revenue,
  oa.total_refund_loss + coalesce(ra.total_refund_loss, 0) as total_refund_loss,
  oa.total_net_revenue,
  oa.total_cogs,
  oa.gross_profit,
  case
    when oa.total_net_revenue > 0 then round((oa.gross_profit / oa.total_net_revenue) * 1000) / 10
    else 0
  end as gross_margin_pct,
  coalesce(ea.total_expenses, 0) as total_expenses,
  oa.gross_profit - coalesce(ea.total_expenses, 0) as net_profit,
  case
    when oa.total_net_revenue > 0 then round(((oa.gross_profit - coalesce(ea.total_expenses, 0)) / oa.total_net_revenue) * 1000) / 10
    else 0
  end as net_profit_margin_pct,
  case
    when (oa.total_delivered_units + oa.total_returned_units + coalesce(ra.total_returned_units, 0)) > 0
    then round(((oa.total_returned_units + coalesce(ra.total_returned_units, 0))::numeric / 
      (oa.total_delivered_units + oa.total_returned_units + coalesce(ra.total_returned_units, 0))) * 1000) / 10
    else 0
  end as overall_return_rate_pct,
  timezone('utc', now()) as refreshed_at
from order_aggregates oa
left join return_aggregates ra on ra.owner_user_id = oa.owner_user_id
left join expense_aggregates ea on ea.owner_user_id = oa.owner_user_id;

create unique index if not exists mv_overall_kpis_pk on public.mv_overall_kpis (owner_user_id);

-- ============================================================
-- 4. Reconciliation View (Ledger vs Analytics)
-- ============================================================
create or replace view public.v_analytics_reconciliation as
with ledger_totals as (
  select
    st.owner_user_id,
    sum(case when st.txn_type = 'SALE_OUT' then st.qty_out * st.unit_cost else 0 end) as ledger_cogs,
    sum(case when st.txn_type = 'SALE_OUT' then st.qty_out else 0 end) as ledger_delivered_qty,
    sum(case when st.txn_type = 'RETURN_IN' then st.qty_in else 0 end) as ledger_returned_qty
  from public.sku_transactions st
  group by st.owner_user_id
),
material_ledger_totals as (
  select
    mt.owner_user_id,
    sum(case when mt.txn_type = 'SALE_OUT' then mt.qty_out * mt.unit_cost else 0 end) as ledger_material_cogs
  from public.material_transactions mt
  group by mt.owner_user_id
),
analytics_totals as (
  select
    owner_user_id,
    sum(cogs) as analytics_cogs,
    sum(units_delivered) as analytics_delivered_qty,
    sum(units_returned) as analytics_returned_qty
  from public.mv_sku_metrics
  group by owner_user_id
),
material_analytics_totals as (
  select
    owner_user_id,
    sum(cogs) as analytics_material_cogs
  from public.mv_sku_metrics
  group by owner_user_id
)
select
  lt.owner_user_id,
  lt.ledger_cogs,
  at.analytics_cogs,
  lt.ledger_cogs - at.analytics_cogs as cogs_drift,
  case when lt.ledger_cogs = 0 then 0 else abs(lt.ledger_cogs - at.analytics_cogs) / lt.ledger_cogs * 100 end as cogs_drift_pct,
  lt.ledger_delivered_qty,
  at.analytics_delivered_qty,
  lt.ledger_delivered_qty - at.analytics_delivered_qty as delivered_qty_drift,
  lt.ledger_returned_qty,
  at.analytics_returned_qty,
  lt.ledger_returned_qty - at.analytics_returned_qty as returned_qty_drift,
  mlt.ledger_material_cogs,
  mat.analytics_material_cogs,
  mlt.ledger_material_cogs - mat.analytics_material_cogs as material_cogs_drift,
  timezone('utc', now()) as checked_at
from ledger_totals lt
join analytics_totals at on at.owner_user_id = lt.owner_user_id
join material_ledger_totals mlt on mlt.owner_user_id = lt.owner_user_id
join material_analytics_totals mat on mat.owner_user_id = lt.owner_user_id;

-- ============================================================
-- 5. Refresh Function
-- ============================================================
create or replace function public.refresh_analytics_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.mv_sku_metrics;
  refresh materialized view concurrently public.mv_platform_metrics;
  refresh materialized view concurrently public.mv_overall_kpis;
end;
$$;

-- Grant permissions
grant select on public.mv_sku_metrics to authenticated;
grant select on public.mv_platform_metrics to authenticated;
grant select on public.mv_overall_kpis to authenticated;
grant select on public.v_analytics_reconciliation to authenticated;