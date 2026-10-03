import 'server-only';
import type { DashboardTenant } from './dashboard';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { isDemoMode } from '@/lib/markting/env';
import { AssistantIntelligenceService } from '@/lib/markting/orchestrator/assistant-service';
import { demoGatherer, emptyGatherer } from '@/lib/markting/orchestrator/demo-gatherer';
import type { IntelligenceRequestContext, IntelligenceIntent } from '@/lib/markting/orchestrator/context';
import type { AssistantAnswer } from '@/lib/markting/orchestrator/answer';

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
  return serviceForMode().run(contextForTenant(tenant, extra), intent);
}

export async function askAssistant(tenant: DashboardTenant, question: string, extra: Partial<IntelligenceRequestContext> = {}): Promise<AssistantAnswer & { intent: IntelligenceIntent }> {
  return serviceForMode().ask(contextForTenant(tenant, extra), question);
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
  return serviceForMode().ask(context, question);
}
