-- Phase 4: normalized SKU dedup key
-- Adds sku_key (canonical, case-insensitive, punctuation-preserving identity)
-- and backfills existing rows. A unique index on (owner_user_id, platform,
-- sku_key) is created when the data allows; if legacy duplicate rows make
-- that impossible, a non-unique lookup index is created and a notice raised
-- (follow-up cleanup task, per non-goal of no retroactive merging).

alter table public.skus add column if not exists sku_key text;

-- Backfill: simple normalization (lowercase, trim, collapse whitespace)
-- NFKC normalization is handled by the application layer (src/lib/business.ts)
update public.skus
set sku_key = lower(btrim(regexp_replace(sku_code, '\s+', ' ', 'g')))
where sku_key is null or sku_key = '';

-- Try to create unique index; fall back to non-unique if legacy duplicates exist
do $$
begin
  begin
    create unique index if not exists skus_owner_platform_sku_key_uniq
      on public.skus (owner_user_id, platform, sku_key)
      where sku_key is not null;
  exception when unique_violation then
    raise notice 'Legacy duplicate normalized SKU keys exist; created a non-unique index instead. Run the follow-up dedup cleanup before adding the unique constraint.';
    create index if not exists skus_owner_platform_sku_key_idx
      on public.skus (owner_user_id, platform, sku_key)
      where sku_key is not null;
  end;
end $$;