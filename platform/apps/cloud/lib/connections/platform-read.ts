import 'server-only';
import { platformDb } from '@/lib/platform/db';
import { allRegistryEntries, connectionRegistry } from './registry';
import { providerLabel } from '@/lib/cloud/providers';

/**
 * CONNECTIONS CONTROL PLANE — the cross-tenant PLATFORM read model (Super Admin Integration Operations
 * Center). Every query runs through the SELECT-only adport_platform_admin role (platformDb). NO secret
 * or token material is ever selected — only non-secret connection metadata, counts and health. The same
 * canonical vocabulary as the tenant surface is used, so operators and tenants never see divergent truth.
 */

export interface FleetOverview {
  totals: { total: number; connected: number; error: number; revoked: number; disabled: number; reauthRequired: number; expiringSoon: number };
  byHealth: Array<{ state: string; n: number }>;
  byStatus: Array<{ status: string; n: number }>;
  byProvider: Array<{ provider: string; label: string; total: number; connected: number; error: number; revoked: number; disabled: number }>;
  byErrorClass: Array<{ errorClass: string; n: number }>;
  commerce: { total: number; active: number; failingSync: number };
}

export async function fleetOverview(): Promise<FleetOverview> {
  const db = platformDb();
  const [[totals], byHealth, byStatus, byProvider, byErrorClass, [commerce]] = await Promise.all([
    db<Array<{ total: number; connected: number; error: number; revoked: number; disabled: number; reauth: number; expiring: number }>>`
      select count(*)::int as total,
        count(*) filter (where status = 'connected' and disabled_at is null)::int as connected,
        count(*) filter (where status = 'error')::int as error,
        count(*) filter (where status = 'revoked')::int as revoked,
        count(*) filter (where disabled_at is not null)::int as disabled,
        count(*) filter (where reauth_required)::int as reauth,
        count(*) filter (where token_expires_at is not null and token_expires_at < now() + interval '7 days')::int as expiring
      from public.connections`,
    db<Array<{ state: string; n: number }>>`select coalesce(health_state, 'UNKNOWN') as state, count(*)::int as n from public.connections group by health_state order by n desc`,
    db<Array<{ status: string; n: number }>>`select status::text as status, count(*)::int as n from public.connections group by status order by n desc`,
    db<Array<{ provider: string; total: number; connected: number; error: number; revoked: number; disabled: number }>>`
      select provider, count(*)::int as total,
        count(*) filter (where status = 'connected' and disabled_at is null)::int as connected,
        count(*) filter (where status = 'error')::int as error,
        count(*) filter (where status = 'revoked')::int as revoked,
        count(*) filter (where disabled_at is not null)::int as disabled
      from public.connections group by provider order by total desc`,
    db<Array<{ errorClass: string; n: number }>>`select coalesce(error_classification, 'NONE') as "errorClass", count(*)::int as n from public.connections where status = 'error' group by error_classification order by n desc`,
    db<Array<{ total: number; active: number; failing: number }>>`
      select count(*)::int as total, count(*) filter (where status = 'active')::int as active,
        (select count(*)::int from public.markting_commerce_sync_state where consecutive_errors > 0 or status = 'error') as failing
      from public.markting_store_connections`,
  ]);
  return {
    totals: {
      total: totals?.total ?? 0, connected: totals?.connected ?? 0, error: totals?.error ?? 0,
      revoked: totals?.revoked ?? 0, disabled: totals?.disabled ?? 0, reauthRequired: totals?.reauth ?? 0,
      expiringSoon: totals?.expiring ?? 0,
    },
    byHealth, byStatus,
    byProvider: byProvider.map((p) => ({ ...p, label: providerLabel(p.provider) })),
    byErrorClass,
    commerce: { total: commerce?.total ?? 0, active: commerce?.active ?? 0, failingSync: commerce?.failing ?? 0 },
  };
}

export interface ProviderDetail {
  provider: string;
  label: string;
  registry: ReturnType<typeof connectionRegistry>;
  organizations: number;
  accounts: number;
  byStatus: Array<{ status: string; n: number }>;
  byHealth: Array<{ state: string; n: number }>;
  byErrorClass: Array<{ errorClass: string; n: number }>;
  connections: Array<{ connectionId: string; organizationId: string; orgName: string; status: string; healthState: string | null; errorClassification: string | null; reauthRequired: boolean; tokenExpiresAt: Date | null; lastVerifiedAt: Date | null; disabledAt: Date | null }>;
}

export async function providerDetail(provider: string): Promise<ProviderDetail> {
  const db = platformDb();
  const [[agg], byStatus, byHealth, byErrorClass, connections, [accts]] = await Promise.all([
    db<Array<{ orgs: number }>>`select count(distinct organization_id)::int as orgs from public.connections where provider = ${provider}`,
    db<Array<{ status: string; n: number }>>`select status::text as status, count(*)::int as n from public.connections where provider = ${provider} group by status`,
    db<Array<{ state: string; n: number }>>`select coalesce(health_state, 'UNKNOWN') as state, count(*)::int as n from public.connections where provider = ${provider} group by health_state`,
    db<Array<{ errorClass: string; n: number }>>`select coalesce(error_classification, 'NONE') as "errorClass", count(*)::int as n from public.connections where provider = ${provider} and status = 'error' group by error_classification`,
    db<ProviderDetail['connections']>`
      select c.id as "connectionId", c.organization_id as "organizationId", o.name as "orgName", c.status::text as status,
        c.health_state as "healthState", c.error_classification as "errorClassification", c.reauth_required as "reauthRequired",
        c.token_expires_at as "tokenExpiresAt", c.last_verified_at as "lastVerifiedAt", c.disabled_at as "disabledAt"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.provider = ${provider} order by (c.status != 'connected') desc, c.last_verified_at desc nulls last limit 200`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.organization_ad_accounts where provider = ${provider}`,
  ]);
  return {
    provider, label: providerLabel(provider), registry: connectionRegistry(provider),
    organizations: agg?.orgs ?? 0, accounts: accts?.n ?? 0, byStatus, byHealth, byErrorClass, connections,
  };
}

export async function connectionDetail(connectionId: string) {
  const rows = await platformDb()<Array<{
    id: string; organizationId: string; orgName: string; provider: string; connectionType: string; authType: string | null;
    environment: string; status: string; healthState: string | null; errorClassification: string | null; lastError: string | null;
    scopes: string[]; scopesRequired: string[]; reauthRequired: boolean; tokenExpiresAt: Date | null; lastAuthenticatedAt: Date | null;
    lastVerifiedAt: Date | null; lastSyncAt: Date | null; lastWebhookAt: Date | null; disabledAt: Date | null; disabledReason: string | null; connectedAt: Date;
  }>>`
    select c.id, c.organization_id as "organizationId", o.name as "orgName", c.provider, c.connection_type as "connectionType",
      c.auth_type as "authType", c.environment, c.status::text as status, c.health_state as "healthState",
      c.error_classification as "errorClassification", c.last_error as "lastError", c.scopes, c.scopes_required as "scopesRequired",
      c.reauth_required as "reauthRequired", c.token_expires_at as "tokenExpiresAt", c.last_authenticated_at as "lastAuthenticatedAt",
      c.last_verified_at as "lastVerifiedAt", c.last_sync_at as "lastSyncAt", c.last_webhook_at as "lastWebhookAt",
      c.disabled_at as "disabledAt", c.disabled_reason as "disabledReason", c.connected_at as "connectedAt"
    from public.connections c join public.organizations o on o.id = c.organization_id
    where c.id = ${connectionId} limit 1`;
  const row = rows[0];
  if (!row) return undefined;
  const events = await platformDb()<Array<{ event: string; actorType: string; reason: string | null; errorClassification: string | null; createdAt: Date }>>`
    select event, actor_type as "actorType", reason, error_classification as "errorClassification", created_at as "createdAt"
    from public.connection_events where connection_id = ${connectionId} order by created_at desc limit 50`;
  return { ...row, registry: connectionRegistry(row.provider), events };
}

/**
 * Deterministic fleet INCIDENT detection (never an LLM). Each incident is a threshold crossed on
 * observable counts: auth-failure spike, rate-limit spike, expiry wave, reauth backlog, sync-failure spike.
 */
export interface ConnectionIncident { kind: string; severity: 'info' | 'warning' | 'critical'; provider: string | null; count: number; title: string; detail: string; dedupeKey: string }

export async function detectConnectionIncidents(): Promise<ConnectionIncident[]> {
  const db = platformDb();
  const [authSpikes, rateLimits, expiring, reauth, syncFails] = await Promise.all([
    db<Array<{ provider: string; n: number }>>`select provider, count(*)::int as n from public.connections where error_classification in ('AUTH_ERROR','TOKEN_EXPIRED') group by provider having count(*) >= 3`,
    db<Array<{ provider: string; n: number }>>`select provider, count(*)::int as n from public.connections where error_classification = 'RATE_LIMIT' or health_state = 'RATE_LIMITED' group by provider having count(*) >= 3`,
    db<Array<{ provider: string; n: number }>>`select provider, count(*)::int as n from public.connections where token_expires_at is not null and token_expires_at < now() + interval '7 days' group by provider having count(*) >= 3`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.connections where reauth_required`,
    db<Array<{ platform: string; n: number }>>`select platform, count(*)::int as n from public.markting_commerce_sync_state s join public.markting_store_connections c on c.connection_id = s.connection_id and c.organization_id = s.organization_id where s.consecutive_errors > 0 group by platform having count(*) >= 3`,
  ]);
  const incidents: ConnectionIncident[] = [];
  for (const r of authSpikes) incidents.push({ kind: 'auth_failure_spike', severity: 'critical', provider: r.provider, count: r.n, title: `Auth failure spike — ${providerLabel(r.provider)}`, detail: `${r.n} connections for ${providerLabel(r.provider)} have auth/token errors. Likely an app-credential or provider-side incident.`, dedupeKey: `auth_spike:${r.provider}` });
  for (const r of rateLimits) incidents.push({ kind: 'rate_limit_spike', severity: 'warning', provider: r.provider, count: r.n, title: `Rate-limit spike — ${providerLabel(r.provider)}`, detail: `${r.n} connections for ${providerLabel(r.provider)} are rate-limited. Back off and retry on a schedule.`, dedupeKey: `rate_limit:${r.provider}` });
  for (const r of expiring) incidents.push({ kind: 'expiry_wave', severity: 'warning', provider: r.provider, count: r.n, title: `Token expiry wave — ${providerLabel(r.provider)}`, detail: `${r.n} ${providerLabel(r.provider)} grants expire within 7 days. Prompt tenants to reauthorize.`, dedupeKey: `expiry:${r.provider}` });
  if ((reauth[0]?.n ?? 0) >= 5) incidents.push({ kind: 'reauth_backlog', severity: 'warning', provider: null, count: reauth[0]!.n, title: 'Reauthorization backlog', detail: `${reauth[0]!.n} connections across the fleet are flagged reauth-required.`, dedupeKey: 'reauth_backlog' });
  for (const r of syncFails) incidents.push({ kind: 'sync_failure_spike', severity: 'warning', provider: r.platform, count: r.n, title: `Commerce sync failures — ${r.platform}`, detail: `${r.n} ${r.platform} stores have consecutive sync errors.`, dedupeKey: `sync_fail:${r.platform}` });
  return incidents;
}

/**
 * Connection Security Center — expiring/revoked credentials, abnormal auth failures, repeated scope
 * problems, rotation needs. No secrets, only metadata.
 */
export async function connectionSecurityCenter() {
  const db = platformDb();
  const [expiring, revoked, authFailing, insufficientScopes, disabled] = await Promise.all([
    db<Array<{ provider: string; organizationId: string; orgName: string; tokenExpiresAt: Date }>>`
      select c.provider, c.organization_id as "organizationId", o.name as "orgName", c.token_expires_at as "tokenExpiresAt"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.token_expires_at is not null and c.token_expires_at < now() + interval '14 days'
      order by c.token_expires_at asc limit 100`,
    db<Array<{ provider: string; organizationId: string; orgName: string; revokedAt: Date | null }>>`
      select c.provider, c.organization_id as "organizationId", o.name as "orgName", c.revoked_at as "revokedAt"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.status = 'revoked' order by c.revoked_at desc nulls last limit 100`,
    db<Array<{ provider: string; organizationId: string; orgName: string; errorClassification: string | null }>>`
      select c.provider, c.organization_id as "organizationId", o.name as "orgName", c.error_classification as "errorClassification"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.error_classification in ('AUTH_ERROR','TOKEN_EXPIRED') order by c.last_verified_at desc nulls last limit 100`,
    db<Array<{ provider: string; organizationId: string; orgName: string }>>`
      select c.provider, c.organization_id as "organizationId", o.name as "orgName"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.error_classification = 'PERMISSION_ERROR' limit 100`,
    db<Array<{ provider: string; organizationId: string; orgName: string; disabledReason: string | null; disabledAt: Date | null }>>`
      select c.provider, c.organization_id as "organizationId", o.name as "orgName", c.disabled_reason as "disabledReason", c.disabled_at as "disabledAt"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.disabled_at is not null order by c.disabled_at desc limit 100`,
  ]);
  return { expiring, revoked, authFailing, insufficientScopes, disabled };
}

/** Connection search across provider / external account / organization / store / stripe ids. No secrets. */
export async function searchConnections(q: string) {
  const query = q.trim();
  if (query.length < 2) return { connections: [], adAccounts: [], stores: [], subscriptions: [] };
  const db = platformDb();
  const like = `%${query}%`;
  const [connections, adAccounts, stores, subscriptions] = await Promise.all([
    db<Array<{ connectionId: string; provider: string; organizationId: string; orgName: string; status: string; externalLabel: string | null }>>`
      select c.id as "connectionId", c.provider, c.organization_id as "organizationId", o.name as "orgName", c.status::text as status, c.external_label as "externalLabel"
      from public.connections c join public.organizations o on o.id = c.organization_id
      where c.provider ilike ${like} or c.external_subject ilike ${like} or c.external_label ilike ${like} or o.name ilike ${like} limit 25`,
    db<Array<{ provider: string; accountId: string; name: string; organizationId: string }>>`
      select provider, account_id as "accountId", name, organization_id as "organizationId"
      from public.organization_ad_accounts where account_id ilike ${like} or name ilike ${like} limit 25`,
    db<Array<{ platform: string; storeId: string; organizationId: string; status: string }>>`
      select platform, store_id as "storeId", organization_id as "organizationId", status
      from public.markting_store_connections where store_id ilike ${like} or external_store_id ilike ${like} or platform ilike ${like} limit 25`,
    db<Array<{ organizationId: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null }>>`
      select organization_id as "organizationId", provider_customer_id as "stripeCustomerId", provider_subscription_id as "stripeSubscriptionId"
      from public.organization_subscriptions where provider_customer_id = ${query} or provider_subscription_id = ${query} limit 25`,
  ]);
  return { connections, adAccounts, stores, subscriptions };
}

/** The static fleet registry (capabilities + auth types) for the admin "providers catalog" view. */
export function registryCatalog() {
  return allRegistryEntries();
}
