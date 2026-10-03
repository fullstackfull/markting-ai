-- Phase 5 — commerce business-truth persistence. Forward-only, additive, tenant-scoped (org-keyed,
-- FK'd, indexed), RLS + revoke per the markting house convention. READ/ANALYZE ONLY: nothing here (or
-- in the app that writes it) mutates a store, product, order, inventory, price, or ad provider.
-- Grants include UPDATE on every table whose writer uses INSERT ... ON CONFLICT DO UPDATE (the Phase-4
-- lesson: a DO UPDATE upsert needs UPDATE privilege, not just INSERT).

create table if not exists public.markting_store_connections (
  connection_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id text,
  store_id text not null,
  platform text not null check (platform in ('salla','zid','shopify','woocommerce','custom')),
  external_store_id text,
  credential_ref text,            -- opaque secret ref, NEVER the secret
  status text not null default 'active' check (status in ('active','revoked','error','pending')),
  scopes jsonb not null default '[]'::jsonb,
  signing_secret_ref text,        -- opaque ref for webhook signature verification
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, connection_id)
);
create index if not exists markting_store_connections_store_idx on public.markting_store_connections (organization_id, store_id);

create table if not exists public.markting_orders (
  order_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id text,
  store_id text not null,
  platform text not null,
  external_order_id text not null,
  order_number text,
  created_at_src timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  currency text not null,
  subtotal_minor bigint not null default 0,
  discount_minor bigint,
  tax_minor bigint,
  shipping_minor bigint,
  gross_minor bigint not null default 0,
  refunded_minor bigint,
  net_minor bigint,
  stage text not null,
  payment_status text not null,
  fulfillment_status text not null,
  customer_pseudo_id text,         -- pseudonymous; never raw email/phone
  customer_class text,
  identity_confidence text,
  acquisition jsonb,               -- utm/referrer/clickIdHashes (hashed), no PII
  trust jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  primary key (organization_id, order_id)
);
create index if not exists markting_orders_store_idx on public.markting_orders (organization_id, store_id, created_at_src);
create index if not exists markting_orders_customer_idx on public.markting_orders (organization_id, customer_pseudo_id);

create table if not exists public.markting_order_lines (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null,
  line_id text not null,
  product_id text,
  variant_id text,
  sku text,
  quantity integer not null default 1,
  unit_price_minor bigint not null default 0,
  discount_minor bigint,
  net_minor bigint,
  cogs_minor bigint,               -- UNKNOWN stays null, never 0
  currency text not null,
  primary key (organization_id, order_id, line_id),
  foreign key (organization_id, order_id) references public.markting_orders (organization_id, order_id) on delete cascade
);
create index if not exists markting_order_lines_sku_idx on public.markting_order_lines (organization_id, sku);

create table if not exists public.markting_refunds (
  refund_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null,
  store_id text not null,
  platform text not null,
  external_refund_id text not null,
  amount_minor bigint not null,
  currency text not null,
  kind text not null check (kind in ('full','partial')),
  refunded_at timestamptz,
  reason text,
  ingested_at timestamptz not null default now(),
  primary key (organization_id, refund_id)
);
create index if not exists markting_refunds_order_idx on public.markting_refunds (organization_id, order_id);

create table if not exists public.markting_products (
  product_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null,
  external_product_id text not null,
  sku text,
  title text,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (organization_id, product_id)
);
create index if not exists markting_products_sku_idx on public.markting_products (organization_id, sku);

create table if not exists public.markting_product_costs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_ref text not null,       -- sku or product_id
  unit_cost_minor bigint not null,
  currency text not null,
  origin text not null check (origin in ('merchant_config','erp_feed','manual_import')),
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, product_ref, created_at)   -- insert-only cost history
);

create table if not exists public.markting_commerce_sync_state (
  connection_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null,
  cursor text,
  high_water timestamptz,
  status text not null default 'idle' check (status in ('idle','running','error')),
  consecutive_errors integer not null default 0,
  last_run_at timestamptz,
  primary key (organization_id, connection_id)
);

create table if not exists public.markting_commerce_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id text not null,
  external_event_id text not null,
  topic text,
  kind text not null default 'webhook',
  detail text,
  received_at timestamptz not null default now(),
  primary key (organization_id, connection_id, external_event_id)  -- dedup identity
);

create table if not exists public.markting_profitability_config (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  config_id text not null default 'default',
  revenue_basis jsonb,
  contribution_config jsonb,
  targets jsonb,
  effective_from timestamptz not null default now(),
  source text not null default 'human_config',
  created_at timestamptz not null default now(),
  primary key (organization_id, config_id, created_at)   -- insert-only config history (traceable)
);

-- Grants (UPDATE included wherever the writer upserts with ON CONFLICT DO UPDATE).
grant select, insert, update on public.markting_store_connections to adport_backend;
grant select, insert, update, delete on public.markting_orders to adport_backend;
grant select, insert, update, delete on public.markting_order_lines to adport_backend;
grant select, insert, update on public.markting_refunds to adport_backend;
grant select, insert, update on public.markting_products to adport_backend;
grant select, insert on public.markting_product_costs to adport_backend;
grant select, insert, update on public.markting_commerce_sync_state to adport_backend;
grant select, insert on public.markting_commerce_events to adport_backend;
grant select, insert on public.markting_profitability_config to adport_backend;

-- RLS + revoke (house convention): browser roles get no grant AND a restrictive policy; server only.
do $$
declare t text;
begin
  foreach t in array array[
    'markting_store_connections', 'markting_orders', 'markting_order_lines', 'markting_refunds',
    'markting_products', 'markting_product_costs', 'markting_commerce_sync_state',
    'markting_commerce_events', 'markting_profitability_config'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_server_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)', t || '_server_only', t);
    execute format('drop policy if exists %I on public.%I', t || '_backend_all', t);
    execute format('create policy %I on public.%I for all to adport_backend using (true) with check (true)', t || '_backend_all', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
