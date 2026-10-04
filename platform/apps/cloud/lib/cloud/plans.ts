import 'server-only';
import { db } from '@/lib/db';
import type { TenantPrincipal } from './types';
import type { UpgradePlanId } from './plan-limit';

export const PLAN_IDS = ['reader', 'operator', 'premium', 'agency', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPriceEur: number | null;
  annualPriceEur: number | null;
  maxActiveAccounts: number | null;
  maxMembers: number | null;
  maxRetentionDays: number;
  writeAccess: boolean;
  clientWorkspaces: boolean;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  reader: {
    id: 'reader', name: 'Free', monthlyPriceEur: 0, annualPriceEur: 0, maxActiveAccounts: 3, maxMembers: 1,
    maxRetentionDays: 30, writeAccess: false, clientWorkspaces: false,
  },
  operator: {
    id: 'operator', name: 'Operator', monthlyPriceEur: 19, annualPriceEur: 190, maxActiveAccounts: 5, maxMembers: 2,
    maxRetentionDays: 90, writeAccess: true, clientWorkspaces: false,
  },
  premium: {
    id: 'premium', name: 'Premium', monthlyPriceEur: 79, annualPriceEur: 790, maxActiveAccounts: 15, maxMembers: 5,
    maxRetentionDays: 365, writeAccess: true, clientWorkspaces: false,
  },
  agency: {
    id: 'agency', name: 'Agency', monthlyPriceEur: 149, annualPriceEur: 1490, maxActiveAccounts: 40, maxMembers: 15,
    maxRetentionDays: 730, writeAccess: true, clientWorkspaces: true,
  },
  enterprise: {
    id: 'enterprise', name: 'Enterprise', monthlyPriceEur: null, annualPriceEur: null, maxActiveAccounts: null, maxMembers: null,
    maxRetentionDays: 3650, writeAccess: true, clientWorkspaces: true,
  },
};

export interface OrganizationEntitlement {
  plan: PlanDefinition;
  status: SubscriptionStatus;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Platform-wide safety ceiling applied AFTER any catalog edit or per-org override — safety always wins. */
const SAFETY_MAX_RETENTION_DAYS = 3650;

/**
 * Resolve the effective plan for an org: base = the admin-editable catalog row (public.platform_plans)
 * if present, else the hard-coded {@link PLANS} default (code fallback); then apply the per-org
 * entitlement override (public.organization_entitlement_overrides), then the safety ceiling. This is
 * the SINGLE canonical resolver — the admin UI edits the catalog/overrides, never a parallel check.
 * Fail-safe: any DB error falls back to the hard-coded plan.
 */
async function resolveEffectivePlan(organizationId: string, planId: PlanId): Promise<PlanDefinition> {
  const fallback = PLANS[planId];
  try {
    const rows = await db()<Array<{
      name: string; monthlyPriceEur: number | null; annualPriceEur: number | null;
      maxActiveAccounts: number | null; maxMembers: number | null; maxRetentionDays: number;
      writeAccess: boolean; clientWorkspaces: boolean;
      ovMaxActiveAccounts: number | null; ovMaxMembers: number | null; ovMaxRetentionDays: number | null;
      ovWriteAccess: boolean | null; ovClientWorkspaces: boolean | null;
    }>>`
      select p.name, p.monthly_price_eur, p.annual_price_eur, p.max_active_accounts, p.max_members,
        p.max_retention_days, p.write_access, p.client_workspaces,
        o.max_active_accounts as ov_max_active_accounts, o.max_members as ov_max_members,
        o.max_retention_days as ov_max_retention_days, o.write_access as ov_write_access,
        o.client_workspaces as ov_client_workspaces
      from public.platform_plans p
      left join public.organization_entitlement_overrides o on o.organization_id = ${organizationId}
      where p.id = ${planId} and p.archived = false
      limit 1
    `;
    const r = rows[0];
    // Trust the catalog row only if it really is one (defends against a stubbed db() in unit tests and
    // any unexpected shape): otherwise fall back to the hard-coded plan.
    if (!r || typeof r.name !== 'string' || typeof r.maxRetentionDays !== 'number') return fallback;
    const maxRetentionDays = Math.min(r.ovMaxRetentionDays ?? r.maxRetentionDays, SAFETY_MAX_RETENTION_DAYS);
    return {
      id: planId,
      name: r.name,
      monthlyPriceEur: r.monthlyPriceEur,
      annualPriceEur: r.annualPriceEur,
      maxActiveAccounts: r.ovMaxActiveAccounts ?? r.maxActiveAccounts,
      maxMembers: r.ovMaxMembers ?? r.maxMembers,
      maxRetentionDays,
      writeAccess: r.ovWriteAccess ?? r.writeAccess,
      clientWorkspaces: r.ovClientWorkspaces ?? r.clientWorkspaces,
    };
  } catch {
    return fallback;
  }
}

export async function getOrganizationEntitlement(organizationId: string): Promise<OrganizationEntitlement> {
  const rows = await db()<Array<{
    plan: PlanId;
    status: SubscriptionStatus;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }>>`
    select plan, status, provider_customer_id, provider_subscription_id, current_period_end, cancel_at_period_end
    from public.organization_subscriptions
    where organization_id = ${organizationId}
    limit 1
  `;
  const subscription = rows[0] ?? {
    plan: 'reader' as const,
    status: 'active' as const,
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
  const entitledPlan = ['active', 'trialing', 'past_due'].includes(subscription.status) ? subscription.plan : 'reader';
  return { ...subscription, plan: await resolveEffectivePlan(organizationId, entitledPlan) };
}

export async function applyPlanToPrincipal(principal: TenantPrincipal): Promise<TenantPrincipal> {
  const [entitlement, membership] = await Promise.all([
    getOrganizationEntitlement(principal.organizationId),
    principal.userId && !principal.role
      ? db()<Array<{ role: NonNullable<TenantPrincipal['role']> }>>`
          select role from public.organization_memberships
          where organization_id = ${principal.organizationId} and user_id = ${principal.userId}
          limit 1
        `
      : Promise.resolve([]),
  ]);
  const role = principal.role ?? membership[0]?.role;
  const writeAllowed = entitlement.plan.writeAccess && role !== 'viewer';
  return {
    ...principal,
    role,
    grantedScopes: principal.grantedScopes ?? principal.scopes,
    entitlement: {
      planId: entitlement.plan.id,
      planName: entitlement.plan.name,
      writeAccess: entitlement.plan.writeAccess,
    },
    scopes: principal.scopes.filter((scope) => scope !== 'tools:write' || writeAllowed),
  };
}

export function formatPlanLimit(value: number | null, unit: string): string {
  if (value === null) return `Unlimited ${unit}`;
  return `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
}

export function recommendedUpgradePlan(plan: PlanId): UpgradePlanId {
  if (plan === 'reader') return 'operator';
  if (plan === 'operator') return 'premium';
  if (plan === 'premium') return 'agency';
  return 'enterprise';
}
