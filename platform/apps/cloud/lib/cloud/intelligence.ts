import 'server-only';
import type { DashboardTenant } from './dashboard';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { isDemoMode } from '@/lib/markting/env';
import { AssistantIntelligenceService } from '@/lib/markting/orchestrator/assistant-service';
import { demoGatherer, emptyGatherer } from '@/lib/markting/orchestrator/demo-gatherer';
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

function serviceForMode(): AssistantIntelligenceService {
  return new AssistantIntelligenceService(isDemoMode() ? demoGatherer : emptyGatherer);
}

export async function loadWorkspaceIntelligence(tenant: DashboardTenant, intent: IntelligenceIntent = 'DAILY_REVIEW', extra: Partial<IntelligenceRequestContext> = {}): Promise<AssistantAnswer> {
  const start = Date.now();
  const answer = guardAnswerPosture(await serviceForMode().run(contextForTenant(tenant, extra), intent));
  emitIntelEvent({ kind: 'orchestrator_answer', organizationId: tenant.organizationId, intent, durationMs: Date.now() - start, aiMode: answer.source, sourceType: isDemoMode() ? 'SYNTHETIC' : 'LIVE', trustTier: answer.trustTier });
  return answer;
}

/** Load a single typed-intent answer (with its analytical section) for a product surface. */
export async function loadSection(tenant: DashboardTenant, intent: IntelligenceIntent, extra: Partial<IntelligenceRequestContext> = {}) {
  return guardAnswerPosture(await serviceForMode().run(contextForTenant(tenant, extra), intent));
}

/** Load the campaign-detail section (campaign scope is not a free-text intent, so built directly). */
export async function loadCampaign(_tenant: DashboardTenant, accountId: string, campaignId: string) {
  const { buildCampaign } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  if (!isDemoMode()) {
    return { found: false as const, campaignId, kind: 'campaign' as const, summary: { en: 'No live provider connected — connect a provider to view campaign detail.', ar: 'لا يوجد مزوّد مرتبط — اربط مزوّدًا لعرض تفاصيل الحملة.' } };
  }
  return buildCampaign(seedClientForAccount(accountId).account, campaignId);
}

/** Lightweight campaign list for an account (links on the account surface). */
export async function loadCampaignList(_tenant: DashboardTenant, accountId: string): Promise<Array<{ id: string; name: string }>> {
  if (!isDemoMode()) return [];
  const { seedClientForAccount } = await import('@/lib/markting/orchestrator/seed');
  return seedClientForAccount(accountId).account.campaigns.map((c) => ({ id: c.id, name: c.name }));
}

/** Creative-detail section (creative scope is not a free-text intent). */
export async function loadCreativeDetail(_tenant: DashboardTenant, creativeId: string, accountId?: string) {
  const { buildCreativeDetail } = await import('@/lib/markting/orchestrator/sections');
  const { seedClientForAccount, SEED_PORTFOLIO } = await import('@/lib/markting/orchestrator/seed');
  if (!isDemoMode()) return { found: false as const, id: creativeId, kind: 'creativeDetail' as const, multimodal: 'MULTIMODAL_NOT_CONFIGURED' as const, summary: { en: 'No live provider connected.', ar: 'لا يوجد مزوّد مرتبط.' } };
  // Find the creative across seeded accounts (creative ids are global in the demo seed).
  const accounts = accountId ? [seedClientForAccount(accountId).account] : SEED_PORTFOLIO.map((c) => c.account);
  for (const acc of accounts) {
    const d = buildCreativeDetail(acc, creativeId);
    if (d.found) return d;
  }
  return buildCreativeDetail(seedClientForAccount(accountId).account, creativeId);
}

export async function askAssistant(tenant: DashboardTenant, question: string, extra: Partial<IntelligenceRequestContext> = {}): Promise<AssistantAnswer & { intent: IntelligenceIntent }> {
  return guardAnswerPosture(await serviceForMode().ask(contextForTenant(tenant, extra), question));
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
  return guardAnswerPosture(await serviceForMode().ask(context, question));
}
