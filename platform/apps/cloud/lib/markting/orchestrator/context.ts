/**
 * Coherence Program 1.1 — the canonical, SERVER-DERIVED intelligence request context.
 *
 * Every orchestrated intelligence request carries this structured context. Security identity
 * (organization, workspace, user, permissions) is derived from the authenticated principal by the
 * caller — NEVER from LLM text or a client-supplied body. The orchestrator treats these fields as
 * trusted inputs and every store/query it drives is scoped by `organizationId`.
 */
import type { RuntimeMode } from '../runtime-mode';

export interface IntelligenceRequestContext {
  /** Tenant identity — server-derived from the session/principal. */
  organizationId: string;
  /** Agency workspace / client grouping, when the deployment uses one. */
  workspaceId?: string;
  /** The authenticated user requesting the analysis (for audit/attribution, never for authorization by name). */
  userId: string;
  /** The user's roles/scopes, server-resolved — used to gate which actions may be offered for review. */
  permissions: string[];
  /** Account under analysis (provider-namespaced id), when scoped to one. */
  accountId?: string;
  /** Provider under analysis, when scoped to one. */
  provider?: string;
  /** The reporting period under analysis. */
  period?: { start: string; end: string };
  /** The comparison (prior) period, when a period-over-period analysis is requested. */
  comparisonPeriod?: { start: string; end: string };
  /** IANA timezone the period boundaries are expressed in. */
  timezone?: string;
  /** Reporting currency (ISO-4217) for monetary roll-ups; the orchestrator never blends currencies. */
  reportingCurrency?: string;
  /** UI locale for bilingual narration selection ('en' | 'ar'); content is always produced in both. */
  locale?: 'en' | 'ar';
  /** The deployment runtime source/mode (DEMO vs LIVE_*) — gates fixture vs live data surfacing. */
  runtimeMode: RuntimeMode;
  /** Tenant business context (targets, break-even, vertical) when configured — structured, not prose. */
  businessContext?: Record<string, unknown>;
}

/** The question intent the orchestrator is being asked to answer, kept typed (not free prose). */
export const INTELLIGENCE_INTENTS = [
  'DAILY_REVIEW',          // "what needs my attention"
  'PROFITABILITY_DECLINE', // "why did profitability decline and what should I do"
  'ACCOUNT_DIAGNOSIS',     // "what is wrong with this account"
  'CAMPAIGN_DIAGNOSIS',
  'OPEN_QUESTION',         // a free-text buyer question, routed deterministically where possible
] as const;
export type IntelligenceIntent = (typeof INTELLIGENCE_INTENTS)[number];
