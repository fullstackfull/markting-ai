/**
 * Selective AI context assembly with budgeting (Phase 1H). Do NOT dump the whole account into every
 * prompt: pick the comparison windows, the top contributing campaigns, and the material anomalies,
 * and summarize the rest deterministically so account size cannot create unbounded model cost. The
 * output is STRUCTURED (not prose) and carries currency/timezone/attribution/trust/targets so the
 * model explains governed signals rather than recomputing them.
 */
import { aggregate, campaignContribution, comparePeriods, type PerformanceChange } from './analysis';
import type { MetricObservation } from './model';

export type DatasetLabel = 'FIXTURE' | 'SANDBOX' | 'LIVE';

export interface KnownTargets {
  targetCpa?: { value: number; currency?: string; status: 'KNOWN' | 'CONFIGURED' | 'DERIVED' | 'UNKNOWN' };
  targetRoas?: { value: number; status: 'KNOWN' | 'CONFIGURED' | 'DERIVED' | 'UNKNOWN' };
  dailyBudget?: { value: number; currency?: string; status: 'KNOWN' | 'CONFIGURED' | 'DERIVED' | 'UNKNOWN' };
}

export interface ContextBudget { maxCampaigns: number; maxRows: number }
export const DEFAULT_BUDGET: ContextBudget = { maxCampaigns: 10, maxRows: 50 };

export interface AnalysisContext {
  organizationId: string;
  dataset: DatasetLabel;
  period: { current: { start: string; end: string }; previous: { start: string; end: string } };
  currency?: string;
  timezone?: string;
  mixedCurrency: boolean;
  trustTier: string;
  windowComplete: boolean;
  targets: KnownTargets;
  accountChange: PerformanceChange;
  topCampaigns: Array<{ id: string; name: string; metrics: Record<string, number>; spendDeltaShare: number }>;
  summarizedCampaignCount: number;
  truncated: boolean;
}

/**
 * Assemble a bounded analysis context. Top campaigns are chosen by their share of the account spend
 * movement (contribution), so the model sees the campaigns that actually explain the change; the
 * remainder are collapsed into a count (never silently dropped — the count is reported).
 */
export function buildAnalysisContext(input: {
  organizationId: string;
  dataset: DatasetLabel;
  currentAccount: MetricObservation[];
  previousAccount: MetricObservation[];
  currentCampaigns: MetricObservation[];
  previousCampaigns: MetricObservation[];
  period: AnalysisContext['period'];
  targets?: KnownTargets;
  budget?: ContextBudget;
}): AnalysisContext {
  const budget = input.budget ?? DEFAULT_BUDGET;
  const acc = aggregate(input.currentAccount);
  const accountChange = comparePeriods(input.currentAccount, input.previousAccount, input.period);
  const contribution = campaignContribution(input.currentCampaigns, input.previousCampaigns, 'spend').contributors;
  const shareById = new Map(contribution.map((c) => [c.entityId, c.sharePct]));
  const ranked = [...input.currentCampaigns].sort((a, b) => (shareById.get(b.entity.id) ?? 0) - (shareById.get(a.entity.id) ?? 0));
  const kept = ranked.slice(0, budget.maxCampaigns);
  const topCampaigns = kept.map((o) => ({
    id: o.entity.id,
    name: o.entity.name,
    metrics: Object.fromEntries(Object.entries(o.metrics).map(([k, v]) => [k, Math.round((v as number) * 100) / 100])),
    spendDeltaShare: Math.round((shareById.get(o.entity.id) ?? 0) * 10) / 10,
  }));
  return {
    organizationId: input.organizationId,
    dataset: input.dataset,
    period: input.period,
    currency: acc.currency,
    timezone: input.currentAccount[0]?.timezone,
    mixedCurrency: acc.mixedCurrency,
    trustTier: acc.worstTier,
    windowComplete: acc.complete,
    targets: input.targets ?? {},
    accountChange,
    topCampaigns,
    summarizedCampaignCount: Math.max(0, input.currentCampaigns.length - kept.length),
    truncated: input.currentCampaigns.length > budget.maxCampaigns,
  };
}
