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
import { detectAnomalies } from './anomaly';
import { classifyTrend } from './trend';
import { analyzeCreatives, type CreativePerf } from './creative';
import { evaluateEvidence, MIN_SAMPLE_FOR_CONFIDENCE, type DataTier } from '../data-trust';
import type { BusinessContext } from '../business-context';
import type { EngineContext } from '../engine-context';
import type { EntityLevel, MetricObservation } from './model';
import type { DatasetLabel } from './context';
import type { BiText, Diagnosis, EvidenceRef, Recommendation } from './decision-model';

export interface AnalyzeInput {
  engineContext: Pick<EngineContext, 'organizationId' | 'timezone' | 'locale'>;
  dataset: DatasetLabel;
  period: { current: { start: string; end: string }; previous: { start: string; end: string } };
  currentAccount: MetricObservation[];
  previousAccount: MetricObservation[];
  currentCampaigns: MetricObservation[];
  previousCampaigns: MetricObservation[];
  /** Lower-hierarchy observations (B2). Each child's `entity.parentRawId` links it to its parent
   *  (ad_group → campaign rawId, ad → ad_group rawId). Optional: absent when a provider/level is not
   *  read or not supported — the engine simply produces no child nodes, never fabricated ones. */
  currentAdGroups?: MetricObservation[];
  previousAdGroups?: MetricObservation[];
  currentAds?: MetricObservation[];
  previousAds?: MetricObservation[];
  business: BusinessContext;
  pacing?: { plannedBudget: number; daysElapsed: number; daysInPeriod: number };
  options?: DiagnoseOptions;
  /** Optional daily metric series keyed by entityId (account key = `${accountId}:account`) for the
   *  anomaly + trend engines. When absent, anomaly/trend are skipped (and stability is not asserted). */
  dailySpendSeries?: Record<string, number[]>;
  /** Optional creative-level data for the creative-freshness health dimension (2L). */
  creatives?: CreativePerf[];
  now?: number;
  idFactory?: () => string;
}

export interface CampaignIntelligence {
  entityId: string;
  name: string;
  diagnoses: Diagnosis[];
  recommendations: Recommendation[];
  spendShare: number;
  /** Canonical level of this node (campaign | ad_group | ad). Omitted for back-compat = campaign. */
  level?: EntityLevel;
  /** Provider-native entity type preserved ("adset"/"ad_group"/"line_item"), for native labelling. */
  entityType?: string;
  /** Lower-hierarchy children (ad_groups under a campaign; ads under an ad_group), when present. */
  children?: CampaignIntelligence[];
  /** Which direct children explain most of this node's spend movement (contribution decomposition). */
  childContribution?: Contributor[];
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

/** Not stale per the supplied staleness bound (true when no bound is given — freshness undetermined). */
function isFresh(agg: ReturnType<typeof aggregate>, dateRange: { start: string; end: string }, staleness?: DiagnoseOptions['staleness']): boolean {
  if (!staleness) return true;
  const v = evaluateEvidence({ tier: agg.worstTier, source: 'aggregate', complete: agg.complete, currency: agg.currency, sampleSize: agg.sampleSize, dateRange }, { ...staleness });
  return !v.reasons.some((r) => r.includes('stale') || r.includes('freshness'));
}
/** Stability from a daily series via the trend engine; undefined when no series (never assume stable). */
function stabilityFrom(series?: number[]): boolean | undefined {
  if (!series || series.length < 7) return undefined;
  const t = classifyTrend(series);
  return !(t.direction === 'down' || t.state === 'STRUCTURAL_SHIFT');
}
function attributionConsistent(cur: MetricObservation[], prev: MetricObservation[]): boolean {
  return (cur[0]?.attribution?.label ?? null) === (prev[0]?.attribution?.label ?? null);
}
/** Build an ANOMALY diagnosis from a daily series when a point is both extreme and material. */
function anomalyDiagnosis(scope: { organizationId: string; accountId: string; entityId: string; entityLevel: 'account' | 'campaign' | 'ad_group' | 'ad' }, series: number[] | undefined, tier: DataTier): Diagnosis | null {
  if (!series) return null;
  const r = detectAnomalies(series);
  if (!r.actionable || !r.top) return null;
  const sev = r.top.classification === 'CRITICAL' ? 'CRITICAL' : 'ATTENTION';
  const summary: BiText = { en: `Anomalous daily spend on day ${r.top.index + 1}: ${r.top.value} vs baseline ${r.top.baseline} (${r.top.pct}%).`, ar: `إنفاق يومي شاذ في اليوم ${r.top.index + 1}: ${r.top.value} مقابل الأساس ${r.top.baseline} (${r.top.pct}%).` };
  const evidence: EvidenceRef = { kind: 'anomaly', metric: 'spend', entityIds: [scope.entityId], entityLevel: scope.entityLevel, values: { index: r.top.index, value: r.top.value, baseline: r.top.baseline, z: r.top.z, pct: r.top.pct ?? null }, dataTrust: tier, calculation: 'robust modified z-score vs rolling baseline, day-of-week deseasonalized' };
  return { type: 'ANOMALY', scope, severity: sev, summary, evidence: [evidence], confidence: 'MEDIUM', dataTrust: tier };
}

export function analyzeAccount(input: AnalyzeInput): AccountIntelligence {
  const now = input.now ?? Date.now();
  const org = input.engineContext.organizationId;
  const accAgg = aggregate(input.currentAccount);
  const accountId = ACCOUNT_ID(input.currentAccount);
  const targets = resolveTargets(input.business);
  const minConversions = MIN_SAMPLE_FOR_CONFIDENCE;
  const series = input.dailySpendSeries ?? {};

  // Account-level diagnosis (now includes funnel-stage collapse from diagnoseEntity) + anomaly.
  const accountScope = { organizationId: org, accountId, entityId: `${accountId}:account`, entityLevel: 'account' as const, name: 'Account' };
  const { diagnoses: accountDiagnoses } = diagnoseEntity({
    scope: accountScope, current: input.currentAccount, previous: input.previousAccount,
    period: input.period, pacing: input.pacing, options: input.options,
  });
  const accAnomaly = anomalyDiagnosis(accountScope, series[accountScope.entityId], accAgg.worstTier as DataTier);
  if (accAnomaly) accountDiagnoses.unshift(accAnomaly);

  // Contribution (spend-delta) across campaigns.
  const contribution = campaignContribution(input.currentCampaigns, input.previousCampaigns, 'spend').contributors;
  const shareById = new Map(contribution.map((c) => [c.entityId, c.sharePct]));
  const totalSpend = accAgg.base.spend ?? 0;

  // Creative-freshness signal (2L) from optional creative data (account-wide for now).
  const creativeFatigueSignal = input.creatives && input.creatives.length
    ? analyzeCreatives(input.creatives, { now }).fatigue.some((f) => f.verdict === 'FATIGUE_SIGNAL')
    : undefined;

  // Per-entity intelligence builder — reused verbatim at campaign, ad_group and ad level (the engine
  // is level-generic; only the scope entityLevel differs). `sharePctById` is the sibling-set spend
  // contribution share for display at that level.
  const buildNode = (cur: MetricObservation, prev: MetricObservation | undefined, sharePctById: Map<string, number>): CampaignIntelligence => {
    const scope = { organizationId: org, accountId: cur.accountId, entityId: cur.entity.id, entityLevel: cur.entity.level, name: cur.entity.name };
    const { diagnoses } = diagnoseEntity({ scope, current: [cur], previous: prev ? [prev] : [], period: input.period, options: input.options });
    const anom = anomalyDiagnosis(scope, series[cur.entity.id], aggregate([cur]).worstTier as DataTier);
    if (anom) diagnoses.unshift(anom);
    const curAgg = aggregate([cur]);
    const spend = curAgg.base.spend ?? 0;
    const conversions = Math.round(curAgg.base.conversions ?? 0);
    const roas = curAgg.derived.roas;
    const cpa = curAgg.derived.cpa;
    const fresh = isFresh(curAgg, input.period.current, input.options?.staleness);
    const recentlyStable = stabilityFrom(series[cur.entity.id]);
    const attrOk = attributionConsistent([cur], prev ? [prev] : []);

    // Scaling / downscale evaluation — real freshness/stability/attribution, not hardcoded.
    const scaling = evaluateScalingReadiness({
      spend, conversions, dataTrust: curAgg.worstTier as DataTier, fresh, windowComplete: curAgg.complete,
      minConversions, attributionReliable: attrOk,
      performanceVsTarget: roas != null && targets.targetRoas ? { metric: 'roas', actual: roas, target: targets.targetRoas.value, targetKnown: targets.targetRoas.status !== 'UNKNOWN' } : undefined,
      recentlyStable,
    });
    const downscale = evaluateDownscaleCandidacy({
      spend, conversions, observationDays: 14, dataTrust: curAgg.worstTier as DataTier,
      performanceVsTarget: cpa != null && targets.targetCpa ? { metric: 'cpa', actual: cpa, target: targets.targetCpa.value, targetKnown: targets.targetCpa.status !== 'UNKNOWN' } : undefined,
      trendWorsening: recentlyStable === false, minConversions,
    });

    const recommendations = generateRecommendations({
      organizationId: org,
      entity: { entityId: cur.entity.id, entityLevel: cur.entity.level, name: cur.entity.name, accountId: cur.accountId },
      diagnoses, facts: { spend, conversions, accountSpendShare: totalSpend > 0 ? spend / totalSpend : 0 },
      scaling, downscale, now, idFactory: input.idFactory,
    });
    return {
      entityId: cur.entity.id, name: cur.entity.name, diagnoses, recommendations,
      spendShare: Math.round((sharePctById.get(cur.entity.id) ?? 0) * 10) / 10,
      level: cur.entity.level, entityType: cur.entity.entityType,
    };
  };

  // Build the child nodes of one parent from a pool, grouped by provider-native parent linkage.
  // Returns the nodes (each still missing its own children) alongside the observations so the next
  // level down can be attached, plus the spend-contribution of these children within the parent.
  const childrenOf = (parentRawId: string, curPool: MetricObservation[], prevPool: MetricObservation[]) => {
    const cur = curPool.filter((o) => o.entity.parentRawId === parentRawId);
    if (!cur.length) return { entries: [] as Array<{ obs: MetricObservation; node: CampaignIntelligence }>, contribution: [] as Contributor[] };
    const prev = prevPool.filter((o) => o.entity.parentRawId === parentRawId);
    const prevMap = new Map(prev.map((o) => [o.entity.id, o]));
    const contribution = campaignContribution(cur, prev, 'spend').contributors;
    const shareById = new Map(contribution.map((c) => [c.entityId, c.sharePct]));
    const entries = cur.map((obs) => ({ obs, node: buildNode(obs, prevMap.get(obs.entity.id), shareById) }));
    return { entries, contribution };
  };

  const adGroupsCur = input.currentAdGroups ?? [];
  const adGroupsPrev = input.previousAdGroups ?? [];
  const adsCur = input.currentAds ?? [];
  const adsPrev = input.previousAds ?? [];

  // Per-campaign intelligence, descending campaign → ad_group → ad where child observations exist.
  const prevByCampaign = new Map(input.previousCampaigns.map((o) => [o.entity.id, o]));
  const campaigns: CampaignIntelligence[] = input.currentCampaigns.map((cur) => {
    const node = buildNode(cur, prevByCampaign.get(cur.entity.id), shareById);
    const groups = childrenOf(cur.entity.rawId, adGroupsCur, adGroupsPrev);
    if (groups.entries.length) {
      node.children = groups.entries.map(({ obs: groupObs, node: groupNode }) => {
        const ads = childrenOf(groupObs.entity.rawId, adsCur, adsPrev);
        if (ads.entries.length) {
          groupNode.children = ads.entries.map((a) => a.node);
          groupNode.childContribution = ads.contribution;
        }
        return groupNode;
      });
      node.childContribution = groups.contribution;
    }
    return node;
  });

  // Account-level recommendations (from account diagnoses — e.g. account overspend/tracking).
  const accountRecs = generateRecommendations({
    organizationId: org,
    entity: { entityId: accountScope.entityId, entityLevel: 'account', name: 'Account', accountId },
    diagnoses: accountDiagnoses, facts: { spend: totalSpend, conversions: Math.round(accAgg.base.conversions ?? 0) },
    now, idFactory: input.idFactory,
  });

  // Account health (dimensions) — now fed conversion-rate, attribution, and creative-fatigue signals.
  const roasActual = accAgg.derived.roas;
  const effGap = roasActual != null ? evaluateTargetGap('roas', roasActual, targets.targetRoas, 5).gap : 'UNKNOWN';
  const pacingResult = input.pacing ? analyzePacing({ spendToDate: totalSpend, plannedBudget: input.pacing.plannedBudget, currency: accAgg.currency, daysElapsed: input.pacing.daysElapsed, daysInPeriod: input.pacing.daysInPeriod, kind: 'period', mixedCurrency: accAgg.mixedCurrency }) : undefined;
  const health = assessHealth({
    dataTrust: accAgg.worstTier as DataTier, windowComplete: accAgg.complete,
    fresh: isFresh(accAgg, input.period.current, input.options?.staleness),
    conversions: Math.round(accAgg.base.conversions ?? 0), minConversions,
    pacing: pacingResult ? ({ ON_TRACK: 'ON_TRACK', OVERPACING: 'OVERPACING', UNDERPACING: 'UNDERPACING', NOT_EVALUABLE: 'NOT_EVALUABLE' } as const)[pacingResult.status] : undefined,
    efficiencyVsTarget: effGap === 'TARGET_ON' ? 'TARGET_ON' : effGap === 'TARGET_BEAT' ? 'TARGET_BEAT' : effGap === 'TARGET_MISS' ? 'TARGET_MISS' : 'UNKNOWN',
    conversionRateWorsening: accountDiagnoses.some((d) => d.type === 'CONVERSION_RATE_DECLINE'),
    attributionConsistent: attributionConsistent(input.currentAccount, input.previousAccount),
    creativeFatigueSignal,
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
