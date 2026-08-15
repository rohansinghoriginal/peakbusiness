-- Peak Business initial production schema.
-- Clerk is the identity provider. Application APIs use the server-only
-- Supabase secret key after Clerk verifies the user, so the public Data API
-- has no end-user access policies.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

create table public.app_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null unique,
  business_name text not null default 'My business',
  default_currency text not null default 'INR',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  sku_code text not null,
  product_name text not null,
  category text,
  platform text not null,
  selling_price numeric(14, 2) not null default 0 check (selling_price >= 0),
  cost_per_unit numeric(14, 2) not null default 0 check (cost_per_unit >= 0),
  opening_stock numeric(14, 3) not null default 0,
  reorder_level numeric(14, 3) not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, sku_code, platform)
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  material_code text not null,
  material_name text not null,
  category text,
  unit text not null default 'pcs',
  opening_stock numeric(14, 3) not null default 0,
  reorder_level numeric(14, 3) not null default 0,
  avg_unit_cost numeric(14, 4) not null default 0 check (avg_unit_cost >= 0),
  preferred_vendor text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, material_code)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  supplier_name text not null,
  address text,
  gstin text,
  phone text,
  email text,
  default_gst_rate numeric(7, 3) not null default 0 check (default_gst_rate >= 0),
  default_transport_cost numeric(14, 2) not null default 0 check (default_transport_cost >= 0),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, supplier_name)
);

create table public.sales_import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  platform text not null,
  file_name text not null,
  imported_at timestamptz not null default timezone('utc', now()),
  total_rows integer not null default 0 check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  unmatched_rows integer not null default 0 check (unmatched_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  notes text
);

create table public.business_orders (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  order_date date not null default current_date,
  platform text not null,
  order_id text not null,
  line_key text not null,
  sku_id uuid not null references public.skus(id) on delete restrict,
  qty_ordered numeric(14, 3) not null default 1 check (qty_ordered >= 0),
  qty_delivered numeric(14, 3) not null default 0 check (qty_delivered >= 0),
  qty_returned numeric(14, 3) not null default 0 check (qty_returned >= 0),
  sale_price numeric(14, 2) not null default 0 check (sale_price >= 0),
  status text not null default 'Pending',
  delivery_date date,
  return_date date,
  customer_location text,
  refund_amount numeric(14, 2) not null default 0 check (refund_amount >= 0),
  notes text,
  import_batch_id uuid references public.sales_import_batches(id) on delete set null,
  source_file text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, platform, line_key)
);

create table public.sku_materials (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  sku_id uuid not null references public.skus(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  qty_per_unit numeric(14, 4) not null default 0 check (qty_per_unit >= 0),
  waste_pct numeric(7, 3) not null default 0 check (waste_pct >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, sku_id, material_id)
);

create table public.sku_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  txn_date date not null default current_date,
  sku_id uuid not null references public.skus(id) on delete cascade,
  txn_type text not null,
  qty_in numeric(14, 3) not null default 0 check (qty_in >= 0),
  qty_out numeric(14, 3) not null default 0 check (qty_out >= 0),
  unit_cost numeric(14, 2) not null default 0 check (unit_cost >= 0),
  order_id uuid references public.business_orders(id) on delete cascade,
  reference text,
  source text,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.material_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  txn_date date not null default current_date,
  material_id uuid not null references public.materials(id) on delete cascade,
  txn_type text not null,
  qty_in numeric(14, 4) not null default 0 check (qty_in >= 0),
  qty_out numeric(14, 4) not null default 0 check (qty_out >= 0),
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  order_id uuid references public.business_orders(id) on delete cascade,
  sku_id uuid references public.skus(id) on delete set null,
  reference text,
  source text,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.material_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  purchase_date date not null default current_date,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14, 3) not null default 0 check (quantity > 0),
  unit text not null,
  unit_price numeric(14, 4) not null default 0 check (unit_price >= 0),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  gst_rate numeric(7, 3) not null default 0 check (gst_rate >= 0),
  gst_amount numeric(14, 2) not null default 0 check (gst_amount >= 0),
  transport_cost numeric(14, 2) not null default 0 check (transport_cost >= 0),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  invoice_no text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, invoice_no, material_id)
);

create table public.borrowings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  direction text not null check (direction in ('borrowed', 'lent')),
  txn_date date not null default current_date,
  counterparty text not null,
  item_type text not null default 'Material',
  item_code text,
  item_name text not null,
  qty numeric(14, 3) not null default 0 check (qty >= 0),
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  qty_returned numeric(14, 3) not null default 0 check (qty_returned >= 0),
  due_date date,
  return_date date,
  settlement_status text not null default 'Open',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (qty_returned <= qty)
);

create table public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  expense_date date not null default current_date,
  category text not null,
  amount numeric(14, 2) not null check (amount > 0),
  description text,
  platform text,
  created_at timestamptz not null default timezone('utc', now())
);

create index skus_owner_product_idx on public.skus (owner_user_id, product_name);
create index materials_owner_name_idx on public.materials (owner_user_id, material_name);
create index orders_owner_date_idx on public.business_orders (owner_user_id, order_date desc);
create index orders_owner_batch_idx on public.business_orders (owner_user_id, import_batch_id);
create index sku_transactions_owner_sku_idx on public.sku_transactions (owner_user_id, sku_id, txn_date desc);
create index material_transactions_owner_material_idx on public.material_transactions (owner_user_id, material_id, txn_date desc);
create index purchases_owner_date_idx on public.material_purchases (owner_user_id, purchase_date desc);
create index borrowings_owner_date_idx on public.borrowings (owner_user_id, txn_date desc);
create index expenses_owner_date_idx on public.business_expenses (owner_user_id, expense_date desc);
create index import_batches_owner_date_idx on public.sales_import_batches (owner_user_id, imported_at desc);

create trigger app_workspaces_set_updated_at before update on public.app_workspaces for each row execute function public.set_updated_at();
create trigger skus_set_updated_at before update on public.skus for each row execute function public.set_updated_at();
create trigger materials_set_updated_at before update on public.materials for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.business_orders for each row execute function public.set_updated_at();
create trigger sku_materials_set_updated_at before update on public.sku_materials for each row execute function public.set_updated_at();
create trigger purchases_set_updated_at before update on public.material_purchases for each row execute function public.set_updated_at();
create trigger borrowings_set_updated_at before update on public.borrowings for each row execute function public.set_updated_at();

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

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
