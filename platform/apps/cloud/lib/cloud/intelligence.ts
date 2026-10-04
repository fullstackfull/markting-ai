import 'server-only';
import type { DashboardTenant } from './dashboard';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { isDemoMode } from '@/lib/markting/env';
import { AssistantIntelligenceService } from '@/lib/markting/orchestrator/assistant-service';
import { demoGatherer } from '@/lib/markting/orchestrator/demo-gatherer';
import { createLiveGatherer } from './live-gatherer';
import type { RangeSelection } from './date-range';
import type { TenantPrincipal } from './types';
import type { IntelligenceRequestContext, IntelligenceIntent } from '@/lib/markting/orchestrator/context';
import type { AssistantAnswer } from '@/lib/markting/orchestrator/answer';
import { assertResultPostureAllowed } from '@/lib/markting/ops/source-guard';
import type { DataTier } from '@/lib/markting/orchestrator/trust';
import { emitIntelEvent } from '@/lib/markting/ops/intel-telemetry';

/**
 * Defense-in-depth source isolation (CODE-RC Program 20): verify the composed answer's trust tier
 * matches the deployment posture before it reaches a surface, so a future regression that wired the
 * demo seed into a live deployment fails CLOSED here rather than leaking synthetic data to a customer.
 * In normal operation this never triggers (DEMO→demoGatherer/SYNTHETIC, live→emptyGatherer/UNVERIFIED).
 */
function guardAnswerPosture<T extends { trustTier: string }>(answer: T): T {
  const verdict = assertResultPostureAllowed(resolveRuntimeMode(), answer.trustTier as DataTier);
  if (!verdict.ok) throw new Error(`source isolation violated: ${verdict.reason}`);
  return answer;
}

/**
 * Coherence Program 3/4 — the server-side bridge from a dashboard tenant to the unified orchestrator.
 *
 * Builds the server-derived IntelligenceRequestContext (identity from the authenticated tenant, never
 * from any client text) and selects the data source honestly by runtime mode: DEMO uses the clearly
 * synthetic demo gatherer; a live deployment with nothing wired yet uses the empty gatherer (truthful
 * NOT_CONNECTED states) rather than demo content. A governed model narrator is substituted here once
 * model credentials exist; until then the answer is DETERMINISTIC_ONLY.
 */
export function contextForTenant(tenant: DashboardTenant, extra: Partial<IntelligenceRequestContext> = {}): IntelligenceRequestContext {
  return {
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    permissions: [tenant.role],
    runtimeMode: resolveRuntimeMode(),
    locale: 'en',
    ...extra,
  };
}

function principalFromTenant(tenant: DashboardTenant): TenantPrincipal {
  return { organizationId: tenant.organizationId, userId: tenant.userId, role: tenant.role, scopes: ['tools:read'] };
}

/**
 * Select the data source honestly by runtime posture: DEMO → the clearly-SYNTHETIC demo gatherer; a live
 * deployment → the LIVE gatherer, which reads the tenant's connected providers through the real engine
 * and degrades to a truthful NOT_CONNECTED empty state when nothing is wired (never demo content).
 */
function serviceForMode(principal: TenantPrincipal, range: RangeSelection = 'last_30_days'): AssistantIntelligenceService {
  if (isDemoMode()) return new AssistantIntelligenceService(demoGatherer);
  return new AssistantIntelligenceService(createLiveGatherer(principal, range));
}

export async function loadWorkspaceIntelligence(tenant: DashboardTenant, intent: IntelligenceIntent = 'DAILY_REVIEW', extra: Partial<IntelligenceRequestContext> = {}, range: RangeSelection = 'last_30_days'): Promise<AssistantAnswer> {
  const start = Date.now();
  const answer = guardAnswerPosture(await serviceForMode(principalFromTenant(tenant), range).run(contextForTenant(tenant, extra), intent));
  emitIntelEvent({ kind: 'orchestrator_answer', organizationId: tenant.organizationId, intent, durationMs: Date.now() - start, aiMode: answer.source, sourceType: isDemoMode() ? 'SYNTHETIC' : 'LIVE', trustTier: answer.trustTier });
  return answer;
}

/** Load a single typed-intent answer (with its analytical section) for a product surface. */
export async function loadSection(tenant: DashboardTenant, intent: IntelligenceIntent, extra: Partial<IntelligenceRequestContext> = {}, range: RangeSelection = 'last_30_days') {
  return guardAnswerPosture(await serviceForMode(principalFromTenant(tenant), range).run(contextForTenant(tenant, extra), intent));
}

/** Load the campaign-detail section (campaign scope is not a free-text intent, so built directly). */
export async function loadCampaign(_tenant: DashboardTenant, accountId: string, campaignId: string) {
  const { buildCampaign } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  if (!isDemoMode()) {
    return { found: false as const, campaignId, kind: 'campaign' as const, summary: { en: 'No live provider connected — connect a provider to view campaign detail.', ar: 'لا يوجد مزوّد مرتبط — اربط مزوّدًا لعرض تفاصيل الحملة.' } };
  }
  const client = seedClientForAccount(accountId);
  if (!client) return { found: false as const, campaignId, kind: 'campaign' as const, summary: { en: 'Account not found.', ar: 'الحساب غير موجود.' } };
  return buildCampaign(client.account, campaignId);
}

/**
 * Campaign rows for an account (the account-surface AnalyticsTable). DEMO reads the seed and returns the
 * computed per-campaign KPIs + CPA trend; a live deployment with nothing wired returns an empty list
 * (the surface then shows the honest NOT_CONNECTED empty state, never demo content).
 */
export async function loadCampaignList(_tenant: DashboardTenant, accountId: string) {
  const { buildCampaignRows } = await import('@/lib/markting/orchestrator/sections');
  if (!isDemoMode()) return [];
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  const client = seedClientForAccount(accountId);
  return client ? buildCampaignRows(client.account) : [];
}

/**
 * PHASE B (B22) — the explicit drill-down data state. NO_DATA = the (seed) source has no rows at this
 * level; NOT_CONNECTED = live with no provider wired; NOT_SUPPORTED_BY_PROVIDER = a connected provider
 * whose adapter does not return this level (reportingLevelSupport NOT_SUPPORTED/NOT_IMPLEMENTED). These
 * are distinct states the surface renders differently — an empty table is never passed off as "no data".
 */
export type DrillState = 'OK' | 'NO_DATA' | 'NOT_CONNECTED' | 'NOT_SUPPORTED_BY_PROVIDER';

/** Ad set / ad group list for a campaign (the campaign-surface AnalyticsTable). */
export async function loadAdGroupList(_tenant: DashboardTenant, accountId: string, campaignId: string): Promise<{ state: DrillState; providerId: string; currency?: string; rows: import('@/lib/markting/orchestrator/sections').AdGroupRow[] }> {
  if (!isDemoMode()) return { state: 'NOT_CONNECTED', providerId: '', rows: [] };
  const { buildCampaign } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  const client = seedClientForAccount(accountId);
  if (!client) return { state: 'NO_DATA', providerId: '', rows: [] };
  const section = buildCampaign(client.account, campaignId);
  const rows = section.adGroups ?? [];
  return { state: rows.length ? 'OK' : 'NO_DATA', providerId: section.providerId ?? '', currency: section.currency, rows };
}

/** Ad-group detail section (ad-group scope is not a free-text intent, so built directly). */
export async function loadAdGroup(_tenant: DashboardTenant, accountId: string, campaignId: string, adGroupId: string) {
  const { buildAdGroup } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  if (!isDemoMode()) return { kind: 'adGroup' as const, found: false as const, campaignId, adGroupId, summary: { en: 'No live provider connected — connect a provider to view ad set / ad group detail.', ar: 'لا يوجد مزوّد مرتبط — اربط مزوّدًا لعرض تفاصيل مجموعة الإعلانات.' } };
  const client = seedClientForAccount(accountId);
  if (!client) return { kind: 'adGroup' as const, found: false as const, campaignId, adGroupId, summary: { en: 'Account not found.', ar: 'الحساب غير موجود.' } };
  return buildAdGroup(client.account, campaignId, adGroupId);
}

/** Ad list for an ad set / ad group. */
export async function loadAdList(_tenant: DashboardTenant, accountId: string, campaignId: string, adGroupId: string): Promise<{ state: DrillState; currency?: string; rows: import('@/lib/markting/orchestrator/sections').AdRow[] }> {
  if (!isDemoMode()) return { state: 'NOT_CONNECTED', rows: [] };
  const { buildAdGroup } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  const client = seedClientForAccount(accountId);
  if (!client) return { state: 'NO_DATA', rows: [] };
  const section = buildAdGroup(client.account, campaignId, adGroupId);
  const rows = section.ads ?? [];
  return { state: rows.length ? 'OK' : 'NO_DATA', currency: section.currency, rows };
}

/** Ad detail section (ad scope is not a free-text intent, so built directly). */
export async function loadAd(_tenant: DashboardTenant, accountId: string, campaignId: string, adGroupId: string, adId: string) {
  const { buildAd } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  if (!isDemoMode()) return { kind: 'ad' as const, found: false as const, campaignId, adGroupId, adId, summary: { en: 'No live provider connected — connect a provider to view ad detail.', ar: 'لا يوجد مزوّد مرتبط — اربط مزوّدًا لعرض تفاصيل الإعلان.' } };
  const client = seedClientForAccount(accountId);
  if (!client) return { kind: 'ad' as const, found: false as const, campaignId, adGroupId, adId, summary: { en: 'Account not found.', ar: 'الحساب غير موجود.' } };
  return buildAd(client.account, campaignId, adGroupId, adId);
}

/** Creative-detail section (creative scope is not a free-text intent). */
export async function loadCreativeDetail(_tenant: DashboardTenant, creativeId: string, accountId?: string) {
  const { buildCreativeDetail } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount, SEED_PORTFOLIO, PRIMARY_CLIENT } = await import('@/lib/markting/orchestrator/seed');
  if (!isDemoMode()) return { found: false as const, id: creativeId, kind: 'creativeDetail' as const, multimodal: 'MULTIMODAL_NOT_CONFIGURED' as const, summary: { en: 'No live provider connected.', ar: 'لا يوجد مزوّد مرتبط.' } };
  // Find the creative across seeded accounts (creative ids are global in the demo seed). An explicit but
  // unknown accountId yields no accounts (C0.3 — no implicit substitution) → a not-found creative detail.
  const scoped = accountId ? seedClientForAccount(accountId) : PRIMARY_CLIENT;
  const accounts = accountId ? (scoped ? [scoped.account] : []) : SEED_PORTFOLIO.map((c) => c.account);
  for (const acc of accounts) {
    const d = buildCreativeDetail(acc, creativeId);
    if (d.found) return d;
  }
  return buildCreativeDetail((scoped ?? PRIMARY_CLIENT).account, creativeId);
}

/**
 * PHASE B (B11) — the Breakdown Explorer view for an account. Capability-gated by the connection
 * registry (via buildBreakdownExplorerView): a dimension is shown ONLY when reachable for the account's
 * provider, and even then at best RAW_ONLY (no provider feeds breakdowns into the normalized path).
 * DEMO reads the CLEARLY SYNTHETIC seed breakdown rows; a live deployment is honestly NOT_CONNECTED
 * (never demo content), because no live breakdown flows into the canonical rows path.
 */
export async function loadBreakdownExplorer(_tenant: DashboardTenant, accountId: string, requested?: string | null) {
  const { buildBreakdownExplorerView } = await import('./breakdown-explorer');
  if (!isDemoMode()) {
    // Live: breakdowns are never in the normalized ReportRow path for ANY provider, so the surface is
    // honestly NOT_CONNECTED and never shows demo content (no provider id is asserted on the tenant here).
    return buildBreakdownExplorerView({ providerId: '', connected: false, requested, rawRowsFor: () => [] });
  }
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  const client = seedClientForAccount(accountId);
  if (!client) return buildBreakdownExplorerView({ providerId: '', connected: false, requested, rawRowsFor: () => [] });
  const acc = client.account;
  const providerId = acc.nativeAdProvider ?? acc.provider;
  return buildBreakdownExplorerView({
    providerId,
    connected: true,
    requested,
    rawRowsFor: (dimension) => acc.breakdowns.filter((b) => b.dimension === dimension).map((b) => ({ ...b, dimension })),
  });
}

export async function askAssistant(tenant: DashboardTenant, question: string, extra: Partial<IntelligenceRequestContext> = {}): Promise<AssistantAnswer & { intent: IntelligenceIntent }> {
  return guardAnswerPosture(await serviceForMode(principalFromTenant(tenant)).ask(contextForTenant(tenant, extra), question));
}

/**
 * Orchestrator-backed assistant answer built from a server-derived TenantPrincipal (used by the chat
 * turn when the external engine is unreachable, so "Ask AI" still answers via the unified path rather
 * than erroring). Identity is taken from the authenticated principal, never from the question text.
 */
export async function askAssistantForPrincipal(
  principal: { organizationId: string; userId?: string; role?: string; scopes?: string[] },
  question: string,
  extra: Partial<IntelligenceRequestContext> = {},
): Promise<AssistantAnswer & { intent: IntelligenceIntent }> {
  const context: IntelligenceRequestContext = {
    organizationId: principal.organizationId,
    userId: principal.userId ?? 'unknown',
    permissions: principal.scopes ?? (principal.role ? [principal.role] : []),
    runtimeMode: resolveRuntimeMode(),
    locale: 'en',
    ...extra,
  };
  const tenantPrincipal: TenantPrincipal = {
    organizationId: principal.organizationId, userId: principal.userId,
    role: principal.role as TenantPrincipal['role'], scopes: principal.scopes ?? ['tools:read'],
  };
  return guardAnswerPosture(await serviceForMode(tenantPrincipal).ask(context, question));
}
