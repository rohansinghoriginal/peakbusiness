-- Schema enhancements for financial correctness and auditability

-- ============================================================
-- 1. BOM Snapshot at order creation (for historical accuracy)
-- ============================================================
alter table public.business_orders 
  add column if not exists bom_snapshot jsonb;

-- ============================================================
-- 2. Entity type discriminator for unified orders table
-- ============================================================
alter table public.business_orders 
  add column if not exists entity_type text 
  check (entity_type in ('order', 'return', 'settlement', 'exchange', 'adjustment'));

-- Backfill existing orders
update public.business_orders 
set entity_type = case 
  when status = 'Returned' then 'return'
  when status in ('Delivered', 'Pending', 'Shipped', 'Packed') then 'order'
  else 'order'
end
where entity_type is null;

-- Make it not null after backfill
alter table public.business_orders 
  alter column entity_type set not null;

-- ============================================================
-- 3. Constraint: qty_returned cannot exceed qty_delivered
-- ============================================================
alter table public.business_orders 
  add constraint chk_qty_returned_le_delivered 
  check (qty_returned <= qty_delivered);

-- ============================================================
-- 4. Weighted Average Cost tracking on materials
-- ============================================================
-- Add WAC calculation columns
alter table public.materials 
  add column if not exists total_purchased_qty numeric(14, 4) not null default 0,
  add column if not exists total_purchased_cost numeric(14, 2) not null default 0;

-- ============================================================
-- 5. Unique constraint for line_key per platform (already exists via unique index)
-- But ensure order_id + line_key combination is unique per tenant
-- Already covered by unique (owner_user_id, platform, line_key)

-- ============================================================
-- 6. Indexes for performance
-- ============================================================
create index if not exists idx_business_orders_owner_entity 
  on public.business_orders (owner_user_id, entity_type, order_date desc);

create index if not exists idx_materials_owner_wac 
  on public.materials (owner_user_id) 
  where total_purchased_qty > 0;

-- ============================================================
-- 7. Function to recalculate WAC on material purchase
-- ============================================================
create or replace function public.recalculate_material_wac(
  p_material_id uuid,
  p_qty numeric,
  p_unit_price numeric
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_qty numeric;
  v_current_cost numeric;
  v_new_qty numeric;
  v_new_avg numeric;
begin
  -- Lock the material row for update
  select total_purchased_qty, avg_unit_cost 
  into v_current_qty, v_current_cost
  from public.materials 
  where id = p_material_id
  for update;
  
  if v_current_qty is null then
    v_current_qty := 0;
    v_current_cost := 0;
  end if;
  
  v_new_qty := v_current_qty + p_qty;
  
  if v_new_qty > 0 then
    v_new_avg := (v_current_cost * v_current_qty + p_qty * p_unit_price) / v_new_qty;
  else
    v_new_avg := 0;
  end if;
  
  update public.materials 
  set 
    total_purchased_qty = v_new_qty,
    avg_unit_cost = v_new_avg,
    total_purchased_cost = total_purchased_cost + (p_qty * p_unit_price),
    updated_at = timezone('utc', now())
  where id = p_material_id;
end;
$$;

-- ============================================================
-- 8. Trigger to auto-update WAC on purchase insert
-- ============================================================
create or replace function public.trigger_update_material_wac()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.txn_type = 'PURCHASE_IN' and new.qty_in > 0 and new.unit_cost > 0 then
    perform public.recalculate_material_wac(new.material_id, new.qty_in, new.unit_cost);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_update_material_wac on public.material_transactions;
create trigger trg_update_material_wac
  after insert on public.material_transactions
  for each row execute function public.trigger_update_material_wac();

-- ============================================================
-- 9. Advisory lock helper for ledger concurrency
-- ============================================================
create or replace function public.get_sku_advisory_lock_id(p_sku_id uuid) returns bigint
language sql immutable
as $$
  select ('x' || substr(md5(p_sku_id::text), 1, 15))::bit(60)::bigint;
$$;

create or replace function public.get_material_advisory_lock_id(p_material_id uuid) returns bigint
language sql immutable
as $$
  select ('x' || substr(md5(p_material_id::text), 1, 15))::bit(60)::bigint;
$$;