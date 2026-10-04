-- CONNECTIONS & INTEGRATIONS CONTROL PLANE
-- Evolve the canonical tenant connection table (public.connections) with canonical lifecycle metadata,
-- and add an append-only connection audit trail. No secrets are added here: token/credential material
-- stays in private.provider_credentials. All new columns are non-secret and covered by the existing
-- member SELECT policy on public.connections and the adport_platform_admin read policy.
--
-- Reuses the existing canonical table rather than creating a second connection model. The richer
-- commerce model (public.markting_store_connections) and health model (public.markting_provider_health)
-- are joined into the canonical read model in code (lib/connections), not duplicated here.

-- 1) Canonical lifecycle columns on public.connections (all nullable/defaulted; safe forward-only add).
alter table public.connections add column if not exists connection_type text not null default 'ad_platform';
alter table public.connections add column if not exists environment text not null default 'production';
alter table public.connections add column if not exists auth_type text;
alter table public.connections add column if not exists scopes_required text[] not null default '{}';
alter table public.connections add column if not exists token_expires_at timestamptz;
alter table public.connections add column if not exists last_authenticated_at timestamptz;
alter table public.connections add column if not exists last_sync_at timestamptz;
alter table public.connections add column if not exists last_webhook_at timestamptz;
alter table public.connections add column if not exists error_classification text;
alter table public.connections add column if not exists health_state text;
alter table public.connections add column if not exists updated_by uuid;
alter table public.connections add column if not exists reauth_required boolean not null default false;
alter table public.connections add column if not exists disabled_at timestamptz;
alter table public.connections add column if not exists disabled_by uuid;
alter table public.connections add column if not exists disabled_reason text;

comment on column public.connections.disabled_at is 'Set by a platform operator to disable a broken connection; disabled connections are never loaded into the tenant runtime.';
comment on column public.connections.reauth_required is 'Set when a tenant/operator flags that the grant must be reauthorized; surfaced in the tenant Connection Center.';

create index if not exists connections_health_idx on public.connections (provider, health_state);
create index if not exists connections_reauth_idx on public.connections (reauth_required) where reauth_required = true;
create index if not exists connections_expiry_idx on public.connections (token_expires_at) where token_expires_at is not null;

-- 2) Append-only connection audit trail. Lifecycle events (connect/reauth/disconnect/revoke/sync/health/
--    disable/reauth_requested/webhook_changed). No secret material is ever written here (detail is jsonb
--    of non-secret facts only). Backend gets SELECT/INSERT only (no UPDATE/DELETE) so the trail is
--    immutable through the app, mirroring public.platform_admin_audit.
create table if not exists public.connection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid,
  provider text not null,
  connection_type text not null default 'ad_platform',
  event text not null,
  actor_type text not null default 'system', -- tenant_user | platform_operator | system
  actor_id uuid,
  platform_role text,
  reason text,
  error_classification text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists connection_events_org_idx on public.connection_events (organization_id, created_at desc);
create index if not exists connection_events_provider_idx on public.connection_events (provider, created_at desc);
create index if not exists connection_events_conn_idx on public.connection_events (connection_id, created_at desc);

alter table public.connection_events enable row level security;
-- Backend path (adport_backend) does tenant-scoped reads/inserts; org isolation is enforced in the query.
create policy connection_events_backend_rw on public.connection_events for select to adport_backend using (true);
create policy connection_events_backend_insert on public.connection_events for insert to adport_backend with check (true);
-- Tenant members may read their own org's connection history through the authenticated PostgREST role.
create policy connection_events_member_read on public.connection_events for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = connection_events.organization_id and m.user_id = auth.uid()
  ));
-- Cross-tenant platform read role (SELECT only).
create policy connection_events_platform_admin_read on public.connection_events for select to adport_platform_admin using (true);

grant select, insert on public.connection_events to adport_backend;
grant select on public.connection_events to adport_platform_admin;
