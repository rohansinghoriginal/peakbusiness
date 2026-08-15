-- RLS Policies for multi-tenant isolation using Clerk user ID
-- Clerk stores user ID in auth.jwt() ->> 'sub'

-- Enable RLS (already done in initial migration, but explicit here)
alter table public.app_workspaces enable row level security;
alter table public.skus enable row level security;
alter table public.materials enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales_import_batches enable row level security;
alter table public.business_orders enable row level security;
alter table public.sku_materials enable row level security;
alter table public.sku_transactions enable row level security;
alter table public.material_transactions enable row level security;
alter table public.material_purchases enable row level security;
alter table public.borrowings enable row level security;
alter table public.business_expenses enable row level security;

-- Helper function to get current user ID from Clerk JWT
create or replace function public.current_user_id() returns text
language sql stable
as $$
  select auth.jwt() ->> 'sub';
$$;

-- ============================================================
-- app_workspaces
-- ============================================================
create policy "workspaces_select" on public.app_workspaces
  for select using (owner_user_id = public.current_user_id());

create policy "workspaces_insert" on public.app_workspaces
  for insert with check (owner_user_id = public.current_user_id());

create policy "workspaces_update" on public.app_workspaces
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "workspaces_delete" on public.app_workspaces
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- skus
-- ============================================================
create policy "skus_select" on public.skus
  for select using (owner_user_id = public.current_user_id());

create policy "skus_insert" on public.skus
  for insert with check (owner_user_id = public.current_user_id());

create policy "skus_update" on public.skus
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "skus_delete" on public.skus
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- materials
-- ============================================================
create policy "materials_select" on public.materials
  for select using (owner_user_id = public.current_user_id());

create policy "materials_insert" on public.materials
  for insert with check (owner_user_id = public.current_user_id());

create policy "materials_update" on public.materials
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "materials_delete" on public.materials
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- suppliers
-- ============================================================
create policy "suppliers_select" on public.suppliers
  for select using (owner_user_id = public.current_user_id());

create policy "suppliers_insert" on public.suppliers
  for insert with check (owner_user_id = public.current_user_id());

create policy "suppliers_update" on public.suppliers
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "suppliers_delete" on public.suppliers
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- sales_import_batches
-- ============================================================
create policy "import_batches_select" on public.sales_import_batches
  for select using (owner_user_id = public.current_user_id());

create policy "import_batches_insert" on public.sales_import_batches
  for insert with check (owner_user_id = public.current_user_id());

create policy "import_batches_update" on public.sales_import_batches
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "import_batches_delete" on public.sales_import_batches
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- business_orders
-- ============================================================
create policy "orders_select" on public.business_orders
  for select using (owner_user_id = public.current_user_id());

create policy "orders_insert" on public.business_orders
  for insert with check (owner_user_id = public.current_user_id());

create policy "orders_update" on public.business_orders
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "orders_delete" on public.business_orders
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- sku_materials (BOM)
-- ============================================================
create policy "sku_materials_select" on public.sku_materials
  for select using (owner_user_id = public.current_user_id());

create policy "sku_materials_insert" on public.sku_materials
  for insert with check (owner_user_id = public.current_user_id());

create policy "sku_materials_update" on public.sku_materials
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "sku_materials_delete" on public.sku_materials
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- sku_transactions
-- ============================================================
create policy "sku_transactions_select" on public.sku_transactions
  for select using (owner_user_id = public.current_user_id());

create policy "sku_transactions_insert" on public.sku_transactions
  for insert with check (owner_user_id = public.current_user_id());

create policy "sku_transactions_update" on public.sku_transactions
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "sku_transactions_delete" on public.sku_transactions
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- material_transactions
-- ============================================================
create policy "material_transactions_select" on public.material_transactions
  for select using (owner_user_id = public.current_user_id());

create policy "material_transactions_insert" on public.material_transactions
  for insert with check (owner_user_id = public.current_user_id());

create policy "material_transactions_update" on public.material_transactions
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "material_transactions_delete" on public.material_transactions
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- material_purchases
-- ============================================================
create policy "purchases_select" on public.material_purchases
  for select using (owner_user_id = public.current_user_id());

create policy "purchases_insert" on public.material_purchases
  for insert with check (owner_user_id = public.current_user_id());

create policy "purchases_update" on public.material_purchases
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "purchases_delete" on public.material_purchases
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- borrowings
-- ============================================================
create policy "borrowings_select" on public.borrowings
  for select using (owner_user_id = public.current_user_id());

create policy "borrowings_insert" on public.borrowings
  for insert with check (owner_user_id = public.current_user_id());

create policy "borrowings_update" on public.borrowings
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "borrowings_delete" on public.borrowings
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- business_expenses
-- ============================================================
create policy "expenses_select" on public.business_expenses
  for select using (owner_user_id = public.current_user_id());

create policy "expenses_insert" on public.business_expenses
  for insert with check (owner_user_id = public.current_user_id());

create policy "expenses_update" on public.business_expenses
  for update using (owner_user_id = public.current_user_id())
  with check (owner_user_id = public.current_user_id());

create policy "expenses_delete" on public.business_expenses
  for delete using (owner_user_id = public.current_user_id());

-- ============================================================
-- Grant permissions to authenticated role for policy evaluation
-- ============================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Service role continues to have full access (bypasses RLS)
grant all privileges on all tables in schema public to service_role;