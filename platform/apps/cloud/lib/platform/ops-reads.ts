import 'server-only';
import { platformDb } from './db';

/**
 * WAVE 6-20 — platform operator READ MODELS for Billing, AI, Providers, Commerce, Jobs, Support,
 * Feature Flags, Settings, Notifications, Data Quality and Global Search. All via the SELECT-only
 * platformDb() role, all bounded. `null`/empty render as NOT_AVAILABLE in the UI, never fabricated.
 */

// ---- Billing & revenue ----
export interface BillingOverview {
  mrrEur: number; // monthly-equivalent list price of paying subs (active + past_due)
  payingSubs: number;
  trials: number;
  byStatus: Record<string, number>;
  openFailures: number;
}
export async function billingOverview(): Promise<BillingOverview> {
  const db = platformDb();
  const [[mrr], byStatus, [trials], [failures]] = await Promise.all([
    db<Array<{ mrr: number; n: number }>>`
      select coalesce(sum(p.monthly_price_eur), 0)::bigint as mrr, count(*)::int as n
      from public.organization_subscriptions s join public.platform_plans p on p.id = s.plan::text
      where s.status in ('active', 'past_due')`,
    db<Array<{ status: string; n: number }>>`select status, count(*)::int as n from public.organization_subscriptions group by status`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.organization_subscriptions where status = 'trialing'`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.billing_failures where resolved = false`,
  ]);
  const byStatusMap: Record<string, number> = {};
  for (const r of byStatus) byStatusMap[r.status] = r.n;
  return { mrrEur: Number(mrr?.mrr ?? 0), payingSubs: mrr?.n ?? 0, trials: trials?.n ?? 0, byStatus: byStatusMap, openFailures: failures?.n ?? 0 };
}
export async function listSubscribers(opts: { status?: string; limit?: number; offset?: number } = {}) {
  const db = platformDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = opts.status ? db`where s.status = ${opts.status}` : db``;
  return db<Array<{ organizationId: string; name: string; plan: string; status: string; currentPeriodEnd: Date | null; stripeCustomerId: string | null }>>`
    select s.organization_id as "organizationId", o.name, s.plan::text as plan, s.status,
      s.current_period_end as "currentPeriodEnd", s.provider_customer_id as "stripeCustomerId"
    from public.organization_subscriptions s join public.organizations o on o.id = s.organization_id
    ${where} order by s.updated_at desc limit ${limit} offset ${offset}`;
}
export async function listBillingFailures(limit = 50) {
  return platformDb()<Array<{ id: string; organizationId: string | null; eventType: string; amountDueMinor: number | null; currency: string | null; attemptCount: number | null; nextAttemptAt: Date | null; resolved: boolean; createdAt: Date }>>`
    select id, organization_id as "organizationId", event_type as "eventType", amount_due_minor as "amountDueMinor",
      currency, attempt_count as "attemptCount", next_attempt_at as "nextAttemptAt", resolved, created_at as "createdAt"
    from public.billing_failures order by created_at desc limit ${Math.min(Math.max(limit, 1), 200)}`;
}
export async function listPlans() {
  return platformDb()<Array<{ id: string; name: string; monthlyPriceEur: number | null; annualPriceEur: number | null; maxActiveAccounts: number | null; maxMembers: number | null; maxRetentionDays: number; writeAccess: boolean; clientWorkspaces: boolean; archived: boolean }>>`
    select id, name, monthly_price_eur as "monthlyPriceEur", annual_price_eur as "annualPriceEur",
      max_active_accounts as "maxActiveAccounts", max_members as "maxMembers", max_retention_days as "maxRetentionDays",
      write_access as "writeAccess", client_workspaces as "clientWorkspaces", archived
    from public.platform_plans order by monthly_price_eur nulls last`;
}

// ---- AI operations ----
export interface AiFleet {
  requests: number; costMicros: number; errors: number; byModel: Array<{ model: string; requests: number; costMicros: number }>;
  topOrgs: Array<{ organizationId: string; name: string; requests: number; costMicros: number }>;
}
export async function aiFleet(): Promise<AiFleet> {
  const db = platformDb();
  const [[tot], byModel, topOrgs] = await Promise.all([
    db<Array<{ requests: number; cost: number; errors: number }>>`
      select count(*) filter (where status != 'local_fallback')::int as requests,
        coalesce(sum(estimated_cost_micros) filter (where status != 'local_fallback'), 0)::bigint as cost,
        count(*) filter (where status = 'error')::int as errors
      from public.markting_ai_usage`,
    db<Array<{ model: string; requests: number; costMicros: number }>>`
      select model, count(*)::int as requests, coalesce(sum(estimated_cost_micros), 0)::bigint as "costMicros"
      from public.markting_ai_usage where status != 'local_fallback' group by model order by requests desc limit 20`,
    db<Array<{ organizationId: string; name: string; requests: number; costMicros: number }>>`
      select u.organization_id as "organizationId", o.name, count(*)::int as requests, coalesce(sum(u.estimated_cost_micros),0)::bigint as "costMicros"
      from public.markting_ai_usage u join public.organizations o on o.id = u.organization_id
      where u.status != 'local_fallback' group by u.organization_id, o.name order by requests desc limit 20`,
  ]);
  return {
    requests: tot?.requests ?? 0, costMicros: Number(tot?.cost ?? 0), errors: tot?.errors ?? 0,
    byModel: byModel.map((m) => ({ ...m, costMicros: Number(m.costMicros) })),
    topOrgs: topOrgs.map((o) => ({ ...o, costMicros: Number(o.costMicros) })),
  };
}

// ---- Provider fleet health ----
export async function providerFleet() {
  const db = platformDb();
  const [connections, health] = await Promise.all([
    db<Array<{ provider: string; status: string; n: number }>>`
      select provider, status::text as status, count(*)::int as n from public.connections group by provider, status order by provider`,
    db<Array<{ provider: string; state: string; n: number }>>`
      select provider, state, count(*)::int as n from public.markting_provider_health group by provider, state order by provider`,
  ]);
  return { connections, health };
}

// ---- Commerce fleet health ----
export async function commerceFleet() {
  const db = platformDb();
  const [stores, sync, [deadletters]] = await Promise.all([
    db<Array<{ platform: string; status: string; n: number }>>`
      select platform, status, count(*)::int as n from public.markting_store_connections group by platform, status order by platform`,
    db<Array<{ organizationId: string; connectionId: string; platform: string; status: string; consecutiveErrors: number; lastRunAt: Date | null }>>`
      select organization_id as "organizationId", connection_id as "connectionId", platform, status,
        consecutive_errors as "consecutiveErrors", last_run_at as "lastRunAt"
      from public.markting_commerce_sync_state where consecutive_errors > 0 or status = 'error'
      order by consecutive_errors desc limit 50`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.markting_commerce_events where kind = 'dead_letter'`,
  ]);
  return { stores, failingSync: sync, deadLetters: deadletters?.n ?? 0 };
}

// ---- Jobs / system ----
export async function jobsOverview() {
  const db = platformDb();
  const [recon, obs] = await Promise.all([
    db<Array<{ status: string; n: number }>>`select status, count(*)::int as n from public.markting_reconciliation_jobs group by status`,
    db<Array<{ status: string; n: number }>>`select status, count(*)::int as n from public.markting_observation_jobs group by status`,
  ]);
  return { reconciliation: recon, observation: obs };
}

// ---- Global audit (unified: platform admin actions + tenant audit) ----
export async function globalAudit(opts: { organizationId?: string; limit?: number } = {}) {
  const db = platformDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const orgFilter = opts.organizationId ? db`where organization_id = ${opts.organizationId}` : db``;
  const [platform, tenant] = await Promise.all([
    db<Array<{ createdAt: Date; actorUserId: string | null; platformRole: string; action: string; targetType: string | null; targetId: string | null; reason: string | null }>>`
      select created_at as "createdAt", actor_user_id as "actorUserId", platform_role as "platformRole", action,
        target_type as "targetType", target_id as "targetId", reason
      from public.platform_admin_audit order by created_at desc limit ${limit}`,
    db<Array<{ createdAt: Date; organizationId: string; actorUserId: string | null; event: string; provider: string | null; summary: string | null }>>`
      select created_at as "createdAt", organization_id as "organizationId", actor_user_id as "actorUserId", event,
        provider, summary from public.audit_events ${orgFilter} order by created_at desc limit ${limit}`,
  ]);
  return { platform, tenant };
}

// ---- Support & customer health ----
export async function supportQueue(limit = 50) {
  return platformDb()<Array<{ id: string; organizationId: string; status: string; subject: string | null; createdAt: Date }>>`
    select f.id, f.organization_id as "organizationId", f.status, f.subject, f.created_at as "createdAt"
    from public.feedback f order by (f.status = 'new') desc, f.created_at desc limit ${Math.min(Math.max(limit, 1), 200)}`
    .catch(() => []);
}

/**
 * Deterministic customer-health rollup (NOT an LLM): for each org, count signals — provider errors,
 * stuck commerce sync, open billing failures, incomplete onboarding, active kill switch. Bounded to
 * the worst N. "health" is a simple deterministic score, never a model judgement.
 */
export async function customerHealth(limit = 50) {
  const db = platformDb();
  return db<Array<{ organizationId: string; name: string; providerErrors: number; stuckSync: number; billingFailures: number; onboardingIncomplete: boolean; frozen: boolean }>>`
    select o.id as "organizationId", o.name,
      (select count(*)::int from public.connections c where c.organization_id = o.id and c.status = 'error') as "providerErrors",
      (select count(*)::int from public.markting_commerce_sync_state s where s.organization_id = o.id and s.consecutive_errors > 0) as "stuckSync",
      (select count(*)::int from public.billing_failures b where b.organization_id = o.id and b.resolved = false) as "billingFailures",
      (select (ob.completed_at is null) from public.organization_onboarding ob where ob.organization_id = o.id) as "onboardingIncomplete",
      exists(select 1 from public.markting_kill_switches k where k.active and ((k.scope = 'ORGANIZATION' and k.scope_key = o.id::text) or k.scope = 'GLOBAL')) as "frozen"
    from public.organizations o
    order by "providerErrors" desc, "stuckSync" desc, "billingFailures" desc
    limit ${Math.min(Math.max(limit, 1), 200)}`;
}

// ---- Feature flags / settings / notifications ----
export async function listFeatureFlags() {
  return platformDb()<Array<{ key: string; scope: string; scopeKey: string; enabled: boolean; rolloutPercent: number; reason: string | null; updatedAt: Date }>>`
    select key, scope, scope_key as "scopeKey", enabled, rollout_percent as "rolloutPercent", reason, updated_at as "updatedAt"
    from public.platform_feature_flags order by key, scope`;
}
export async function listSettings() {
  return platformDb()<Array<{ key: string; value: unknown; description: string | null; updatedAt: Date }>>`
    select key, value, description, updated_at as "updatedAt" from public.platform_settings order by key`;
}
export async function listNotifications(opts: { includeAcknowledged?: boolean; limit?: number } = {}) {
  const db = platformDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const where = opts.includeAcknowledged ? db`` : db`where acknowledged = false`;
  return db<Array<{ id: string; kind: string; severity: string; title: string; detail: string | null; acknowledged: boolean; createdAt: Date }>>`
    select id, kind, severity, title, detail, acknowledged, created_at as "createdAt"
    from public.platform_admin_notifications ${where} order by created_at desc limit ${limit}`;
}

// ---- Data quality fleet ----
export async function dataQualityFleet(limit = 50) {
  return platformDb()<Array<{ organizationId: string; name: string; platform: string; connectionId: string; consecutiveErrors: number; status: string; lastRunAt: Date | null }>>`
    select s.organization_id as "organizationId", o.name, s.platform, s.connection_id as "connectionId",
      s.consecutive_errors as "consecutiveErrors", s.status, s.last_run_at as "lastRunAt"
    from public.markting_commerce_sync_state s join public.organizations o on o.id = s.organization_id
    where s.consecutive_errors > 0 or s.status = 'error' or s.last_run_at < now() - interval '2 days'
    order by s.consecutive_errors desc, s.last_run_at asc nulls first
    limit ${Math.min(Math.max(limit, 1), 200)}`;
}

// ---- Global search ----
export async function globalSearch(q: string) {
  const query = q.trim();
  if (query.length < 2) return { organizations: [], users: [], subscriptions: [] };
  const db = platformDb();
  const like = `%${query}%`;
  const [organizations, users, subscriptions] = await Promise.all([
    db<Array<{ id: string; name: string; slug: string }>>`
      select id, name, slug from public.organizations where name ilike ${like} or slug ilike ${like} limit 10`,
    db<Array<{ userId: string; displayName: string }>>`
      select user_id as "userId", display_name as "displayName" from public.profiles
      where display_name ilike ${like} or user_id::text = ${query} limit 10`,
    db<Array<{ organizationId: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null }>>`
      select organization_id as "organizationId", provider_customer_id as "stripeCustomerId", provider_subscription_id as "stripeSubscriptionId"
      from public.organization_subscriptions where provider_customer_id = ${query} or provider_subscription_id = ${query} limit 10`,
  ]);
  return { organizations, users, subscriptions };
}
