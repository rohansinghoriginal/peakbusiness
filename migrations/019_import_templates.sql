-- Import templates for saved column mappings and document configurations
CREATE TABLE IF NOT EXISTS import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  name text NOT NULL,
  description text,
  platform text NOT NULL,
  doc_type text,
  file_name_pattern text, -- regex or glob pattern to match file names
  sheet_name_pattern text, -- regex or glob pattern to match sheet names
  column_mapping jsonb NOT NULL DEFAULT '{}', -- { "orderId": "Order ID", "skuCode": "SKU", ... }
  header_row_index integer,
  is_default boolean NOT NULL DEFAULT false,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_templates_owner_platform_idx ON import_templates (owner_user_id, platform);
CREATE INDEX IF NOT EXISTS import_templates_name_idx ON import_templates (owner_user_id, name);