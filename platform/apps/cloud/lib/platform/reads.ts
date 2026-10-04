import 'server-only';
import { platformDb } from './db';

/**
 * WAVE 2-5 — platform cross-tenant READ MODELS. Every query runs through platformDb() (the SELECT-only
 * adport_platform_admin role) and is bounded (count or limit/offset) — never a full-table load. A
 * value of `null` means the datum is genuinely NOT_AVAILABLE from the current data model, which the UI
 * renders explicitly rather than faking.
 */

export interface PlatformOverview {
  users: number;
  organizations: number;
  activeOrganizations: number;
  trials: number;
  subscriptionsByStatus: Record<string, number>;
  connectedAdAccounts: number;
  connectedStores: number;
  aiRequests: number;
  aiCostMicros: number;
  onboardingCompleted: number;
  pendingApprovals: number;
  activeKillSwitches: number;
}

export async function platformOverview(): Promise<PlatformOverview> {
  const db = platformDb();
  const [[users], [orgs], subs, [accounts], [stores], [ai], [onboarded], [pending], [kills]] = await Promise.all([
    db<Array<{ n: number }>>`select count(*)::int as n from public.profiles`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.organizations`,
    db<Array<{ status: string; n: number }>>`select status, count(*)::int as n from public.organization_subscriptions group by status`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.organization_ad_accounts where enabled = true`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.markting_store_connections where status = 'active'`,
    db<Array<{ n: number; cost: number }>>`select count(*)::int as n, coalesce(sum(estimated_cost_micros), 0)::bigint as cost from public.markting_ai_usage where status != 'local_fallback'`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.organization_onboarding where completed_at is not null`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.pending_operations where state = 'pending'`,
    db<Array<{ n: number }>>`select count(*)::int as n from public.markting_kill_switches where active = true`,
  ]);
  const byStatus: Record<string, number> = {};
  for (const row of subs) byStatus[row.status] = row.n;
  const activeOrganizations = (byStatus.active ?? 0) + (byStatus.trialing ?? 0) + (byStatus.past_due ?? 0);
  return {
    users: users?.n ?? 0,
    organizations: orgs?.n ?? 0,
    activeOrganizations,
    trials: byStatus.trialing ?? 0,
    subscriptionsByStatus: byStatus,
    connectedAdAccounts: accounts?.n ?? 0,
    connectedStores: stores?.n ?? 0,
    aiRequests: ai?.n ?? 0,
    aiCostMicros: Number(ai?.cost ?? 0),
    onboardingCompleted: onboarded?.n ?? 0,
    pendingApprovals: pending?.n ?? 0,
    activeKillSwitches: kills?.n ?? 0,
  };
}

export interface OrgListRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  members: number;
  adAccounts: number;
  createdAt: Date;
}

export async function listOrganizations(opts: { search?: string; limit?: number; offset?: number } = {}): Promise<{ rows: OrgListRow[]; total: number }> {
  const db = platformDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = (opts.search ?? '').trim();
  const like = `%${search}%`;
  const where = search ? db`where o.name ilike ${like} or o.slug ilike ${like}` : db``;
  const [rows, [count]] = await Promise.all([
    db<OrgListRow[]>`
      select o.id, o.name, o.slug,
        coalesce(s.plan::text, 'reader') as plan,
        coalesce(s.status, 'active') as status,
        (select count(*)::int from public.organization_memberships m where m.organization_id = o.id) as members,
        (select count(*)::int from public.organization_ad_accounts a where a.organization_id = o.id and a.enabled) as "adAccounts",
        o.created_at as "createdAt"
      from public.organizations o
      left join public.organization_subscriptions s on s.organization_id = o.id
      ${where}
      order by o.created_at desc
      limit ${limit} offset ${offset}
    `,
    db<Array<{ n: number }>>`select count(*)::int as n from public.organizations o ${where}`,
  ]);
  return { rows, total: count?.n ?? 0 };
}

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string | null;
  onboardingCompletedAt: Date | null;
  members: Array<{ userId: string; role: string; displayName: string | null }>;
  adAccounts: Array<{ provider: string; accountId: string; name: string; enabled: boolean; status: string | null }>;
  connections: Array<{ provider: string; status: string; lastError: string | null; lastVerifiedAt: Date | null }>;
  aiRequests: number;
  aiCostMicros: number;
  activeKillSwitches: Array<{ scope: string; scopeKey: string; reason: string | null }>;
  entitlementOverride: { maxActiveAccounts: number | null; maxMembers: number | null; maxRetentionDays: number | null } | null;
  aiLimit: { aiDisabled: boolean; maxRequests: number | null; maxCostMicros: number | null } | null;
}

export async function getOrganizationDetail(id: string): Promise<OrgDetail | null> {
  const db = platformDb();
  const [org] = await db<Array<{ id: string; name: string; slug: string; createdAt: Date }>>`
    select id, name, slug, created_at as "createdAt" from public.organizations where id = ${id} limit 1`;
  if (!org) return null;
  const [sub, members, adAccounts, connections, [ai], [onboarding], kills, [override], [aiLimit]] = await Promise.all([
    db<Array<{ plan: string; status: string; currentPeriodEnd: Date | null; stripeCustomerId: string | null }>>`
      select plan::text as plan, status, current_period_end as "currentPeriodEnd", provider_customer_id as "stripeCustomerId"
      from public.organization_subscriptions where organization_id = ${id} limit 1`,
    db<Array<{ userId: string; role: string; displayName: string | null }>>`
      select m.user_id as "userId", m.role::text as role, p.display_name as "displayName"
      from public.organization_memberships m
      left join public.profiles p on p.user_id = m.user_id
      where m.organization_id = ${id} order by m.created_at asc limit 200`,
    db<Array<{ provider: string; accountId: string; name: string; enabled: boolean; status: string | null }>>`
      select provider, account_id as "accountId", name, enabled, status
      from public.organization_ad_accounts where organization_id = ${id} order by provider, name limit 200`,
    db<Array<{ provider: string; status: string; lastError: string | null; lastVerifiedAt: Date | null }>>`
      select provider, status::text as status, last_error as "lastError", last_verified_at as "lastVerifiedAt"
      from public.connections where organization_id = ${id} order by provider limit 50`,
    db<Array<{ n: number; cost: number }>>`
      select count(*)::int as n, coalesce(sum(estimated_cost_micros), 0)::bigint as cost
      from public.markting_ai_usage where organization_id = ${id} and status != 'local_fallback'`,
    db<Array<{ completedAt: Date | null }>>`select completed_at as "completedAt" from public.organization_onboarding where organization_id = ${id} limit 1`,
    db<Array<{ scope: string; scopeKey: string; reason: string | null }>>`
      select scope, scope_key as "scopeKey", reason from public.markting_kill_switches
      where active = true and (organization_id = ${id} or organization_id is null)`,
    db<Array<{ maxActiveAccounts: number | null; maxMembers: number | null; maxRetentionDays: number | null }>>`
      select max_active_accounts as "maxActiveAccounts", max_members as "maxMembers", max_retention_days as "maxRetentionDays"
      from public.organization_entitlement_overrides where organization_id = ${id} limit 1`,
    db<Array<{ aiDisabled: boolean; maxRequests: number | null; maxCostMicros: number | null }>>`
      select ai_disabled as "aiDisabled", max_requests_per_window as "maxRequests", max_cost_micros_per_window as "maxCostMicros"
      from public.organization_ai_limits where organization_id = ${id} limit 1`,
  ]);
  return {
    id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt,
    plan: sub[0]?.plan ?? 'reader', status: sub[0]?.status ?? 'active',
    currentPeriodEnd: sub[0]?.currentPeriodEnd ?? null, stripeCustomerId: sub[0]?.stripeCustomerId ?? null,
    onboardingCompletedAt: onboarding?.completedAt ?? null,
    members, adAccounts, connections,
    aiRequests: ai?.n ?? 0, aiCostMicros: Number(ai?.cost ?? 0),
    activeKillSwitches: kills,
    entitlementOverride: override ?? null,
    aiLimit: aiLimit ? { aiDisabled: aiLimit.aiDisabled, maxRequests: aiLimit.maxRequests, maxCostMicros: aiLimit.maxCostMicros != null ? Number(aiLimit.maxCostMicros) : null } : null,
  };
}

export interface PlatformAuditRow {
  id: string; actorUserId: string | null; platformRole: string; action: string;
  targetType: string | null; targetId: string | null; reason: string | null; correlationId: string | null; createdAt: Date;
}

export async function listPlatformAudit(limit = 100): Promise<PlatformAuditRow[]> {
  return platformDb()<PlatformAuditRow[]>`
    select id, actor_user_id as "actorUserId", platform_role as "platformRole", action,
      target_type as "targetType", target_id as "targetId", reason, correlation_id as "correlationId", created_at as "createdAt"
    from public.platform_admin_audit order by created_at desc limit ${Math.min(Math.max(limit, 1), 500)}`;
}

export async function listActiveKillSwitchesAll(): Promise<Array<{ scope: string; scopeKey: string; organizationId: string | null; reason: string | null; setAt: Date | null }>> {
  return platformDb()<Array<{ scope: string; scopeKey: string; organizationId: string | null; reason: string | null; setAt: Date | null }>>`
    select scope, scope_key as "scopeKey", organization_id as "organizationId", reason, set_at as "setAt"
    from public.markting_kill_switches where active = true order by scope`;
}

export interface UserListRow { userId: string; displayName: string; orgCount: number; createdAt: Date; isOperator: boolean }

export async function listUsers(opts: { search?: string; limit?: number; offset?: number } = {}): Promise<{ rows: UserListRow[]; total: number }> {
  const db = platformDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = (opts.search ?? '').trim();
  const like = `%${search}%`;
  const where = search ? db`where p.display_name ilike ${like} or p.user_id::text = ${search}` : db``;
  const [rows, [count]] = await Promise.all([
    db<UserListRow[]>`
      select p.user_id as "userId", p.display_name as "displayName",
        (select count(*)::int from public.organization_memberships m where m.user_id = p.user_id) as "orgCount",
        p.created_at as "createdAt",
        exists(select 1 from public.platform_operators o where o.user_id = p.user_id and o.status = 'active') as "isOperator"
      from public.profiles p
      ${where}
      order by p.created_at desc
      limit ${limit} offset ${offset}
    `,
    db<Array<{ n: number }>>`select count(*)::int as n from public.profiles p ${where}`,
  ]);
  return { rows, total: count?.n ?? 0 };
}

export interface UserDetail {
  userId: string;
  displayName: string | null;
  createdAt: Date | null;
  isOperator: boolean;
  operatorRole: string | null;
  memberships: Array<{ organizationId: string; organizationName: string; role: string }>;
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const db = platformDb();
  const [profile] = await db<Array<{ displayName: string | null; createdAt: Date | null }>>`
    select display_name as "displayName", created_at as "createdAt" from public.profiles where user_id = ${id} limit 1`;
  const [memberships, [op]] = await Promise.all([
    db<Array<{ organizationId: string; organizationName: string; role: string }>>`
      select m.organization_id as "organizationId", o.name as "organizationName", m.role::text as role
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = ${id} order by m.created_at asc limit 100`,
    db<Array<{ role: string }>>`select role from public.platform_operators where user_id = ${id} and status = 'active' limit 1`,
  ]);
  if (!profile && memberships.length === 0 && !op) return null;
  return {
    userId: id,
    displayName: profile?.displayName ?? null,
    createdAt: profile?.createdAt ?? null,
    isOperator: Boolean(op),
    operatorRole: op?.role ?? null,
    memberships,
  };
}
