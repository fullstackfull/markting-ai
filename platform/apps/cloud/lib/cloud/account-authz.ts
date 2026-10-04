import 'server-only';
import { notFound } from 'next/navigation';
import { isDemoMode } from '@/lib/markting/env';
import { db } from '@/lib/db';
import type { DashboardTenant } from './dashboard';

/**
 * PHASE C0.1 — the ONE canonical tenant↔account authorization guard.
 *
 * Every account-scoped tenant route (account, campaign, group, ad, creative, breakdown,
 * recommendation/experiment/observation surfaces that are account-linked) calls this after resolving
 * the signed-in tenant. It answers a single question — does this organization own this ad account? —
 * and is the cross-tenant security boundary: campaigns/groups/ads/creatives/breakdowns are always
 * nested WITHIN an account, so authorizing the account (plus the nested parent-chain integrity the
 * section builders already enforce by returning found=false on a mismatch) is sufficient and avoids
 * per-route bespoke authorization logic.
 *
 * Ownership source of truth:
 *   - DEMO runtime: the synthetic seed portfolio (the only accounts that exist).
 *   - Live runtime: public.organization_ad_accounts scoped to the org (discovered via its connections).
 *
 * Failure is INDISTINGUISHABLE from "does not exist": we call Next notFound() for both a cross-tenant
 * account and an unknown account, so the response never reveals whether the id exists in another tenant
 * (no access-denied-vs-not-found oracle). This also removes the Phase-B implicit fallback where an
 * unknown account silently resolved to the primary demo account (C0.3).
 */
export async function tenantOwnsAccount(tenant: Pick<DashboardTenant, 'organizationId'>, accountId: string | undefined | null): Promise<boolean> {
  if (!accountId) return false;
  if (isDemoMode()) {
    const { SEED_PORTFOLIO } = await import('@/lib/markting/orchestrator/seed');
    return SEED_PORTFOLIO.some((client) => client.account.accountId === accountId);
  }
  const rows = await db()<Array<{ one: number }>>`
    select 1 as one from public.organization_ad_accounts
    where organization_id = ${tenant.organizationId} and account_id = ${accountId}
    limit 1
  `;
  return rows.length > 0;
}

/**
 * Authorize an account-scoped request, or render the app's not-found page. Never reveals cross-tenant
 * existence. Call at the top of every account-scoped route, right after requireDashboardTenant().
 */
export async function authorizeTenantAccount(tenant: Pick<DashboardTenant, 'organizationId'>, accountId: string | undefined | null): Promise<void> {
  if (!(await tenantOwnsAccount(tenant, accountId))) notFound();
}
