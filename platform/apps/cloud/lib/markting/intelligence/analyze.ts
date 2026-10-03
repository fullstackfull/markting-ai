/**
 * Phase 2 orchestrator — the single deterministic entry that turns normalized observations + business
 * context into a structured `AccountIntelligence`. This is what the production assistant path calls
 * (Workstream 0.3): there is ONE intelligence path, not a fixture-only alternate. The LLM later
 * narrates this object; it never produces the findings. Everything here is currency-safe, evidence-
 * gated and tenant-scoped (organizationId comes from the server-derived EngineContext, never prose).
 */
import { aggregate, campaignContribution, type Contributor } from './analysis';
import { diagnoseEntity, type DiagnoseOptions } from './diagnostics';
import { assessHealth } from './health';
import { analyzePacing, type PacingResult } from './pacing';
import { evaluateScalingReadiness, evaluateDownscaleCandidacy } from './scaling';
import { analyzeCrossCampaign, type CrossCampaignReport } from './cross-campaign';
import { generateRecommendations } from './recommendation';
import { resolveTargets, evaluateTargetGap } from './targets';
import { MIN_SAMPLE_FOR_CONFIDENCE, type DataTier } from '../data-trust';
import type { BusinessContext } from '../business-context';
import type { EngineContext } from '../engine-context';
import type { MetricObservation } from './model';
import type { DatasetLabel } from './context';
import type { Diagnosis, Recommendation } from './decision-model';

export interface AnalyzeInput {
  engineContext: Pick<EngineContext, 'organizationId' | 'timezone' | 'locale'>;
  dataset: DatasetLabel;
  period: { current: { start: string; end: string }; previous: { start: string; end: string } };
  currentAccount: MetricObservation[];
  previousAccount: MetricObservation[];
  currentCampaigns: MetricObservation[];
  previousCampaigns: MetricObservation[];
  business: BusinessContext;
  pacing?: { plannedBudget: number; daysElapsed: number; daysInPeriod: number };
  options?: DiagnoseOptions;
  now?: number;
  idFactory?: () => string;
}

export interface CampaignIntelligence {
  entityId: string;
  name: string;
  diagnoses: Diagnosis[];
  recommendations: Recommendation[];
  spendShare: number;
}

export interface AccountIntelligence {
  organizationId: string;
  dataset: DatasetLabel;
  period: AnalyzeInput['period'];
  currency?: string;
  timezone?: string;
  mixedCurrency: boolean;
  trustTier: DataTier;
  windowComplete: boolean;
  accountDiagnoses: Diagnosis[];
  contribution: Contributor[];
  health: ReturnType<typeof assessHealth>;
  pacing?: PacingResult;
  crossCampaign: CrossCampaignReport;
  campaigns: CampaignIntelligence[];
  recommendations: Recommendation[];
}

const ACCOUNT_ID = (obs: MetricObservation[]): string => obs[0]?.accountId ?? 'unknown';

export function analyzeAccount(input: AnalyzeInput): AccountIntelligence {
  const now = input.now ?? Date.now();
  const org = input.engineContext.organizationId;
  const accAgg = aggregate(input.currentAccount);
  const accountId = ACCOUNT_ID(input.currentAccount);
  const targets = resolveTargets(input.business);
  const minConversions = MIN_SAMPLE_FOR_CONFIDENCE;

  // Account-level diagnosis.
  const accountScope = { organizationId: org, accountId, entityId: `${accountId}:account`, entityLevel: 'account' as const, name: 'Account' };
  const { diagnoses: accountDiagnoses } = diagnoseEntity({
    scope: accountScope, current: input.currentAccount, previous: input.previousAccount,
    period: input.period, pacing: input.pacing, options: input.options,
  });

  // Contribution (spend-delta) across campaigns.
  const contribution = campaignContribution(input.currentCampaigns, input.previousCampaigns, 'spend').contributors;
  const shareById = new Map(contribution.map((c) => [c.entityId, c.sharePct]));
  const totalSpend = accAgg.base.spend ?? 0;

  // Per-campaign intelligence.
  const prevByCampaign = new Map(input.previousCampaigns.map((o) => [o.entity.id, o]));
  const campaigns: CampaignIntelligence[] = input.currentCampaigns.map((cur) => {
    const prev = prevByCampaign.get(cur.entity.id);
    const scope = { organizationId: org, accountId: cur.accountId, entityId: cur.entity.id, entityLevel: cur.entity.level, name: cur.entity.name };
    const { diagnoses } = diagnoseEntity({ scope, current: [cur], previous: prev ? [prev] : [], period: input.period, options: input.options });
    const curAgg = aggregate([cur]);
    const spend = curAgg.base.spend ?? 0;
    const conversions = Math.round(curAgg.base.conversions ?? 0);
    const roas = curAgg.derived.roas;
    const cpa = curAgg.derived.cpa;

    // Scaling / downscale evaluation for this campaign.
    const roasGap = roas != null ? evaluateTargetGap('roas', roas, targets.targetRoas, 5) : { gap: 'UNKNOWN' as const, targetKnown: false };
    const scaling = evaluateScalingReadiness({
      spend, conversions, dataTrust: curAgg.worstTier as DataTier, fresh: true, windowComplete: curAgg.complete,
      minConversions, attributionReliable: true,
      performanceVsTarget: roas != null && targets.targetRoas ? { metric: 'roas', actual: roas, target: targets.targetRoas.value, targetKnown: targets.targetRoas.status !== 'UNKNOWN' } : undefined,
      recentlyStable: true,
    });
    const downscale = evaluateDownscaleCandidacy({
      spend, conversions, observationDays: 14, dataTrust: curAgg.worstTier as DataTier,
      performanceVsTarget: cpa != null && targets.targetCpa ? { metric: 'cpa', actual: cpa, target: targets.targetCpa.value, targetKnown: targets.targetCpa.status !== 'UNKNOWN' } : undefined,
      minConversions,
    });

    const recommendations = generateRecommendations({
      organizationId: org,
      entity: { entityId: cur.entity.id, entityLevel: cur.entity.level, name: cur.entity.name, accountId: cur.accountId },
      diagnoses, facts: { spend, conversions, accountSpendShare: totalSpend > 0 ? spend / totalSpend : 0 },
      scaling, downscale, now, idFactory: input.idFactory,
    });
    void roasGap;
    return { entityId: cur.entity.id, name: cur.entity.name, diagnoses, recommendations, spendShare: Math.round((shareById.get(cur.entity.id) ?? 0) * 10) / 10 };
  });

  // Account-level recommendations (from account diagnoses — e.g. account overspend/tracking).
  const accountRecs = generateRecommendations({
    organizationId: org,
    entity: { entityId: accountScope.entityId, entityLevel: 'account', name: 'Account', accountId },
    diagnoses: accountDiagnoses, facts: { spend: totalSpend, conversions: Math.round(accAgg.base.conversions ?? 0) },
    now, idFactory: input.idFactory,
  });

  // Account health (dimensions).
  const roasActual = accAgg.derived.roas;
  const effGap = roasActual != null ? evaluateTargetGap('roas', roasActual, targets.targetRoas, 5).gap : 'UNKNOWN';
  const pacingResult = input.pacing ? analyzePacing({ spendToDate: totalSpend, plannedBudget: input.pacing.plannedBudget, currency: accAgg.currency, daysElapsed: input.pacing.daysElapsed, daysInPeriod: input.pacing.daysInPeriod, kind: 'period', mixedCurrency: accAgg.mixedCurrency }) : undefined;
  const health = assessHealth({
    dataTrust: accAgg.worstTier as DataTier, windowComplete: accAgg.complete, fresh: true,
    conversions: Math.round(accAgg.base.conversions ?? 0), minConversions,
    pacing: pacingResult ? ({ ON_TRACK: 'ON_TRACK', OVERPACING: 'OVERPACING', UNDERPACING: 'UNDERPACING', NOT_EVALUABLE: 'NOT_EVALUABLE' } as const)[pacingResult.status] : undefined,
    efficiencyVsTarget: effGap === 'TARGET_ON' ? 'TARGET_ON' : effGap === 'TARGET_BEAT' ? 'TARGET_BEAT' : effGap === 'TARGET_MISS' ? 'TARGET_MISS' : 'UNKNOWN',
    trackingOk: !(totalSpend > 0 && (accAgg.base.conversions ?? 0) === 0),
  });

  const crossCampaign = analyzeCrossCampaign(input.currentCampaigns);

  return {
    organizationId: org, dataset: input.dataset, period: input.period,
    currency: accAgg.currency, timezone: input.engineContext.timezone, mixedCurrency: accAgg.mixedCurrency,
    trustTier: accAgg.worstTier as DataTier, windowComplete: accAgg.complete,
    accountDiagnoses, contribution, health, pacing: pacingResult, crossCampaign, campaigns,
    recommendations: [...accountRecs, ...campaigns.flatMap((c) => c.recommendations)],
  };
}
