/**
 * Coherence-2 — analytical "answer sections" computed by the REAL deterministic engines over the seed.
 *
 * Each builder runs an actual engine (pacing, anomaly, forecast, trend, response-curve/saturation/
 * marginal, scaling, allocation, MER/margin/reconciliation) so a surface or the Assistant can answer a
 * specific media-buyer question with a genuine computation + inspectable evidence — not a hard-coded
 * string. The seed figures are synthetic; they are passed to the engines as if platform-reported so the
 * computation runs, while every surface marks the deployment DEMO (the composed trust reads non-live).
 */
import type { BiText } from '../intelligence/decision-model';
import { analyzePacing, type PacingResult } from '../intelligence/pacing';
import { detectAnomalies, type AnomalyReport } from '../intelligence/anomaly';
import { forecastCumulative, forecastCpa, type Forecast } from '../intelligence/forecast';
import { classifyTrend, type TrendResult } from '../intelligence/trend';
import { fitResponseCurve, detectSaturation, marginalMetrics, type ResponseCurve, type SaturationResult, type MarginalResult, type ResponsePoint } from '../optimize/response-curve';
import { evaluateScalingReadiness, type ScalingResult } from '../intelligence/scaling';
import { allocateExtra, type AllocationResult, type CandidateSignals } from '../optimize/allocation';
import type { Candidate } from '../optimize/constraints';
import { computeMER, type MER } from '../commerce/metrics';
import { computeMargin, breakEvenRoas } from '../commerce/profit';
import type { MarginObservation } from '../commerce/model';
import { reconcile, type ReconciliationResult } from '../commerce/reconciliation';
import { analyzeBreakdown, type BreakdownAnalysis, type BreakdownDimension, type BreakdownRow } from '../intelligence/audience';
import { compareChannels, type ChannelSummary, type CrossChannelComparison } from '../intelligence/cross-channel';
import type { SeedAccount, SeedCampaign, SeedClient, SeedCreative } from './seed';
import { SEED_PORTFOLIO } from './seed';

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const half = <T,>(xs: T[]): [T[], T[]] => [xs.slice(0, Math.floor(xs.length / 2)), xs.slice(Math.floor(xs.length / 2))];
const money = (minorUnits: number, currency: string) => ({ minorUnits, currency });
const cpaOf = (c: SeedCampaign) => { const conv = sum(c.dailyConversions); return conv ? Math.round(sum(c.dailySpendMinor) / conv) : 0; };
const roasOf = (c: SeedCampaign) => { const sp = sum(c.dailySpendMinor); return sp ? Math.round((sum(c.dailyRevenueMinor) / sp) * 100) / 100 : 0; };
const dailyCpa = (c: SeedCampaign) => c.dailySpendMinor.map((s, i) => (c.dailyConversions[i] ? s / c.dailyConversions[i]! : 0));

const WINDOW = { start: '2026-09-16', end: '2026-10-03' };

// ---------- Pacing ----------
export interface PacingSection { kind: 'pacing'; summary: BiText; result: PacingResult; }
export function buildPacing(acc: SeedAccount): PacingSection {
  const spendToDate = sum(acc.campaigns.map((c) => sum(c.dailySpendMinor)));
  const plannedBudget = sum(acc.campaigns.map((c) => c.budgetMinor));
  const result = analyzePacing({ spendToDate, plannedBudget, currency: acc.reportingCurrency, daysElapsed: acc.periodDaysElapsed, daysInPeriod: acc.periodDays, kind: 'period' });
  return { kind: 'pacing', summary: result.label, result };
}

// ---------- Anomaly ----------
export interface AnomalySection { kind: 'anomaly'; summary: BiText; report: AnomalyReport; metric: string; }
export function buildAnomaly(acc: SeedAccount): AnomalySection {
  const series = acc.campaigns[0]?.dailySpendMinor ?? [];
  const report = detectAnomalies(series);
  const summary: BiText = report.actionable
    ? { en: `Anomaly detected in daily spend (z=${report.top?.z}).`, ar: `رُصد شذوذ في الإنفاق اليومي (z=${report.top?.z}).` }
    : { en: 'No material spend/conversion anomaly in the window.', ar: 'لا شذوذ جوهري في الإنفاق/التحويلات خلال الفترة.' };
  return { kind: 'anomaly', summary, report, metric: 'spend' };
}

// ---------- Forecast ----------
export interface ForecastSection { kind: 'forecast'; summary: BiText; spend: Forecast; conversions: Forecast; cpa: Forecast; horizonDays: number; }
export function buildForecast(acc: SeedAccount): ForecastSection {
  const n = acc.campaigns[0]?.dailySpendMinor.length ?? 1;
  const dailySpend = Array.from({ length: n }, (_, i) => sum(acc.campaigns.map((c) => c.dailySpendMinor[i] ?? 0)));
  const dailyConv = Array.from({ length: n }, (_, i) => sum(acc.campaigns.map((c) => c.dailyConversions[i] ?? 0)));
  const horizon = Math.max(1, acc.periodDays - acc.periodDaysElapsed);
  const spend = forecastCumulative('spend', dailySpend, horizon);
  const conversions = forecastCumulative('conversions', dailyConv, horizon);
  const cpa = forecastCpa(dailySpend, dailyConv);
  return {
    kind: 'forecast', spend, conversions, cpa, horizonDays: horizon,
    summary: { en: `Projected ${horizon}-day spend ≈ ${spend.estimate} (band ${spend.low}–${spend.high}); CPA trend ≈ ${cpa.estimate}.`, ar: `الإنفاق المتوقع لـ ${horizon} يومًا ≈ ${spend.estimate} (النطاق ${spend.low}–${spend.high})؛ اتجاه CPA ≈ ${cpa.estimate}.` },
  };
}

// ---------- Trend ----------
export interface TrendSection { kind: 'trend'; summary: BiText; cpa: TrendResult; spend: TrendResult; }
export function buildTrend(acc: SeedAccount): TrendSection {
  const c = acc.campaigns[0]!;
  const cpa = classifyTrend(dailyCpa(c));
  const spend = classifyTrend(c.dailySpendMinor);
  return { kind: 'trend', cpa, spend, summary: cpa.label };
}

// ---------- Response curve / saturation / marginal ----------
export interface ResponseSection { kind: 'response'; summary: BiText; curve: ResponseCurve; saturation: SaturationResult; marginal: MarginalResult; }
export function buildResponse(acc: SeedAccount): ResponseSection {
  const c = acc.campaigns[0]!;
  const points: ResponsePoint[] = c.dailySpendMinor.map((s, i) => ({ spendMinor: s, conversions: c.dailyConversions[i], revenueMinor: c.dailyRevenueMinor[i] }));
  const curve = fitResponseCurve(points, c.currency);
  const cpaTrend = classifyTrend(dailyCpa(c));
  const saturation = detectSaturation({ spendRising: classifyTrend(c.dailySpendMinor).direction === 'up', marginalConversionsWeakening: cpaTrend.direction === 'up', cpaWorsening: cpaTrend.direction === 'up', frequencyRising: c.dominantCreativeFatigue !== 'NO_SIGNAL' });
  const [a, b] = half(points);
  const prev = { spendMinor: Math.round(sum(a.map((p) => p.spendMinor)) / Math.max(1, a.length)), conversions: Math.round(sum(a.map((p) => p.conversions ?? 0)) / Math.max(1, a.length)) };
  const next = { spendMinor: Math.round(sum(b.map((p) => p.spendMinor)) / Math.max(1, b.length)), conversions: Math.round(sum(b.map((p) => p.conversions ?? 0)) / Math.max(1, b.length)) };
  const marginal = marginalMetrics(prev, next);
  return { kind: 'response', curve, saturation, marginal, summary: saturation.label };
}

// ---------- Scaling readiness (per campaign) ----------
export interface ScalingRow { campaignId: string; name: string; result: ScalingResult; }
export interface ScalingSection { kind: 'scaling'; summary: BiText; rows: ScalingRow[]; }
export function buildScaling(acc: SeedAccount): ScalingSection {
  const rows = acc.campaigns.map((c) => {
    const spend = sum(c.dailySpendMinor); const conv = sum(c.dailyConversions);
    const stable = classifyTrend(dailyCpa(c)).state === 'NOISE';
    const result = evaluateScalingReadiness({
      spend, conversions: conv,
      performanceVsTarget: c.targetRoas ? { metric: 'roas', actual: roasOf(c), target: c.targetRoas, targetKnown: c.targetKnown } : undefined,
      recentlyStable: stable, dataTrust: 'PLATFORM_REPORTED', fresh: true, windowComplete: false,
      budgetUtilization: spend / c.budgetMinor, attributionReliable: true,
    });
    return { campaignId: c.id, name: c.name, result };
  });
  const ready = rows.filter((r) => r.result.state === 'READY_FOR_HUMAN_REVIEW').length;
  return { kind: 'scaling', rows, summary: { en: `${ready} of ${rows.length} campaigns are scaling-ready for review.`, ar: `${ready} من ${rows.length} حملات جاهزة للمراجعة للتوسّع.` } };
}

// ---------- Scenario / budget allocation ----------
export interface ScenarioSection { kind: 'scenario'; summary: BiText; extraMinor: number; currency: string; conservative: AllocationResult; balanced: AllocationResult; aggressiveReview: AllocationResult; }
export function buildScenario(acc: SeedAccount, extraMinor = 100000): ScenarioSection {
  const currency = acc.reportingCurrency;
  const candidates = acc.campaigns.filter((c) => c.currency === currency).map((c) => {
    const candidate: Candidate = { id: c.id, accountId: acc.accountId, currentBudgetMinor: c.budgetMinor, currency: c.currency, role: c.role };
    const cpaTrend = classifyTrend(dailyCpa(c));
    const signals: CandidateSignals = {
      targetKnown: c.targetKnown, beatingTarget: c.targetRoas ? roasOf(c) >= c.targetRoas : undefined,
      saturation: cpaTrend.direction === 'up' ? 'SATURATION_SIGNAL' : 'NO_SIGNAL',
      creativeFatigue: c.dominantCreativeFatigue, inventoryRisk: c.inventoryRisk,
      attribution: 'PLATFORM_REPORTED', dataTrustOk: true,
      scaleReady: c.targetKnown && !!c.targetRoas && roasOf(c) >= c.targetRoas && c.dominantCreativeFatigue === 'NO_SIGNAL',
    };
    return { candidate, signals };
  });
  const hard = { orgMaxBudgetMinor: sum(acc.campaigns.map((c) => c.budgetMinor)) * 2, currency };
  const conservative = allocateExtra({ extraMinor, currency, candidates, hard, soft: { conservativeScaling: true, preserveBrandCampaigns: true } });
  const balanced = allocateExtra({ extraMinor, currency, candidates, hard, soft: { favorProfitableGrowth: true } });
  const aggressiveReview = allocateExtra({ extraMinor, currency, candidates, hard, soft: { favorAcquisitionVolume: true } });
  return { kind: 'scenario', extraMinor, currency, conservative, balanced, aggressiveReview, summary: { en: `Where to review allocating an extra ${extraMinor} ${currency} across ${candidates.length} eligible campaigns.`, ar: `أين تراجع تخصيص ${extraMinor} ${currency} إضافية عبر ${candidates.length} حملات مؤهلة.` } };
}

// ---------- Creative ----------
export type CreativeState = 'NEW' | 'STRONG' | 'FATIGUE_WATCH' | 'UNDERPERFORMING' | 'INSUFFICIENT_EVIDENCE';
export interface CreativeRow { id: string; name: string; campaignId: string; hook: string; angle: string; format: string; spendMinor: number; ctr: number; conversions: number; state: CreativeState; fatigue: 'NO_SIGNAL' | 'WATCH' | 'FATIGUE_SIGNAL'; spendSharePct: number; }
export interface CreativeSection { kind: 'creative'; summary: BiText; rows: CreativeRow[]; hooks: Array<{ hook: string; conversions: number; spendMinor: number }>; concentrationPct: number; }
export function buildCreative(acc: SeedAccount): CreativeSection {
  const totalSpend = sum(acc.creatives.map((c) => c.spendMinor)) || 1;
  const rows: CreativeRow[] = acc.creatives.map((cr: SeedCreative) => {
    const ctrTrend = classifyTrend(cr.ctrSeries);
    const freqTrend = classifyTrend(cr.frequencySeries);
    const fatigue = ctrTrend.direction === 'down' && ctrTrend.state !== 'NOISE' && freqTrend.direction === 'up' ? 'FATIGUE_SIGNAL'
      : ctrTrend.direction === 'down' && freqTrend.direction === 'up' ? 'WATCH' : 'NO_SIGNAL';
    const ctr = cr.impressions ? Math.round((cr.clicks / cr.impressions) * 10000) / 100 : 0;
    const state: CreativeState = cr.conversions < 30 && cr.firstSeenDaysAgo < 14 ? 'INSUFFICIENT_EVIDENCE'
      : fatigue === 'FATIGUE_SIGNAL' ? 'FATIGUE_WATCH'
      : cr.firstSeenDaysAgo < 14 ? 'NEW'
      : cr.conversions >= 300 ? 'STRONG' : 'UNDERPERFORMING';
    return { id: cr.id, name: cr.name, campaignId: cr.campaignId, hook: cr.hook, angle: cr.angle, format: cr.format, spendMinor: cr.spendMinor, ctr, conversions: cr.conversions, state, fatigue, spendSharePct: Math.round((cr.spendMinor / totalSpend) * 1000) / 10 };
  });
  const hooksMap = new Map<string, { conversions: number; spendMinor: number }>();
  for (const cr of acc.creatives) { const h = hooksMap.get(cr.hook) ?? { conversions: 0, spendMinor: 0 }; h.conversions += cr.conversions; h.spendMinor += cr.spendMinor; hooksMap.set(cr.hook, h); }
  const hooks = [...hooksMap.entries()].map(([hook, v]) => ({ hook, ...v })).sort((a, b) => b.conversions - a.conversions);
  const concentrationPct = rows.length ? Math.max(...rows.map((r) => r.spendSharePct)) : 0;
  const fatiguing = rows.filter((r) => r.fatigue === 'FATIGUE_SIGNAL').length;
  return { kind: 'creative', rows, hooks, concentrationPct, summary: { en: `${rows.length} creatives; ${fatiguing} showing a fatigue signal; top spend concentration ${concentrationPct}%.`, ar: `${rows.length} إعلانات؛ ${fatiguing} تُظهر إشارة إجهاد؛ أعلى تركّز إنفاق ${concentrationPct}%.` } };
}

// ---------- Commerce / profit ----------
export interface CommerceSection { kind: 'commerce'; summary: BiText; available: boolean; refundRatePct?: number; mer?: MER; margin?: MarginObservation; reconciliation?: ReconciliationResult; aovChangePct?: number; note?: BiText; }
export function buildCommerce(acc: SeedAccount): CommerceSection {
  const c = acc.commerce;
  if (!c) return { kind: 'commerce', available: false, note: { en: 'No commerce store connected for this account.', ar: 'لا يوجد متجر مرتبط بهذا الحساب.' }, summary: { en: 'Commerce not connected.', ar: 'التجارة غير مرتبطة.' } };
  const net = c.merchantRevenueMinor - c.refundsMinor;
  const refundRatePct = c.grossMinor ? Math.round((c.refundsMinor / c.grossMinor) * 1000) / 10 : 0;
  const mer = computeMER({ basis: 'net', source: 'merchant', revenue: money(net, c.currency), adSpend: money(c.adSpendMinor, c.currency), adSpendScope: 'all_channels', window: WINDOW, trust: 'PLATFORM_REPORTED' });
  const margin = computeMargin({ netRevenue: money(net, c.currency), cogs: c.cogsMinor == null ? null : money(c.cogsMinor, c.currency), adSpend: money(c.adSpendMinor, c.currency) });
  const reconciliation = reconcile({ platformRevenue: money(c.platformRevenueMinor, c.currency), merchantRevenue: money(c.merchantRevenueMinor, c.currency), merchantOrderCount: c.orderCount });
  const aovChangePct = c.aovMinorPrev ? Math.round(((c.aovMinorNow - c.aovMinorPrev) / c.aovMinorPrev) * 1000) / 10 : undefined;
  const be = breakEvenRoas(margin);
  const summary: BiText = {
    en: `Net revenue ${net} ${c.currency}, refunds ${refundRatePct}% of gross, MER ${mer.value ?? 'UNKNOWN'}, ${margin.notComputableReason ? 'margin UNKNOWN (COGS missing)' : `contribution margin ${margin.contributionMarginPct}%`}; ${be.state === 'BREAK_EVEN_KNOWN' ? `break-even ROAS ${be.breakEvenRoas}` : 'break-even unknown'}.`,
    ar: `صافي الإيراد ${net} ${c.currency}، الاستردادات ${refundRatePct}% من الإجمالي، MER ${mer.value ?? 'غير معروف'}، ${margin.notComputableReason ? 'الهامش غير معروف (COGS مفقود)' : `هامش المساهمة ${margin.contributionMarginPct}%`}.`,
  };
  return { kind: 'commerce', available: true, refundRatePct, mer, margin, reconciliation, aovChangePct, summary };
}

// ---------- Outcomes ----------
export interface OutcomeRow { recommendationId: string; title: BiText; status: string; executed: boolean; outcomeClass: string; causalStance: string; contamination: string[]; }
export interface OutcomesSection { kind: 'outcomes'; summary: BiText; rows: OutcomeRow[]; }
export function buildOutcomes(acc: SeedAccount): OutcomesSection {
  const rows: OutcomeRow[] = acc.outcomes.map((o) => ({ recommendationId: o.recommendationId, title: { en: o.titleEn, ar: o.titleAr }, status: o.status, executed: o.executed, outcomeClass: o.outcomeClass, causalStance: o.causalStance, contamination: o.contamination }));
  const measured = rows.filter((r) => r.executed && r.outcomeClass !== 'OUTCOME_PENDING').length;
  return { kind: 'outcomes', rows, summary: { en: `${rows.length} past recommendations; ${measured} measured. A rejected recommendation is not a failure; before/after is never called causal.`, ar: `${rows.length} توصيات سابقة؛ ${measured} مُقاسة. التوصية المرفوضة ليست فشلًا؛ ولا يُنسب السبب من مقارنة قبل/بعد.` } };
}

// ---------- Memory ----------
export interface MemoryRow { key: string; value: BiText; source: string; trust: string; dateIso: string; revoked: boolean; }
export interface MemorySection { kind: 'memory'; summary: BiText; rows: MemoryRow[]; }
export function buildMemory(acc: SeedAccount): MemorySection {
  const rows: MemoryRow[] = acc.memory.map((m) => ({ key: m.key, value: { en: m.valueEn, ar: m.valueAr }, source: m.source, trust: m.trust, dateIso: m.dateIso, revoked: !!m.revoked }));
  return { kind: 'memory', rows, summary: { en: `${rows.length} business-context/memory items; each shows source, trust and date.`, ar: `${rows.length} عناصر سياق/ذاكرة؛ يُظهر كل منها المصدر والموثوقية والتاريخ.` } };
}

// ---------- Experiments ----------
export interface ExperimentRow { id: string; title: BiText; state: string; hypothesis: BiText; readiness: string; }
export interface ExperimentsSection { kind: 'experiments'; summary: BiText; rows: ExperimentRow[]; }
export function buildExperiments(acc: SeedAccount): ExperimentsSection {
  const rows: ExperimentRow[] = acc.experiments.map((x) => ({ id: x.id, title: { en: x.titleEn, ar: x.titleAr }, state: x.state, hypothesis: { en: x.hypothesisEn, ar: x.hypothesisAr }, readiness: x.readiness }));
  return { kind: 'experiments', rows, summary: { en: `${rows.length} experiment(s). Nothing launches automatically; experiments are reviewed and saved.`, ar: `${rows.length} تجربة. لا شيء يُطلق تلقائيًا؛ تُراجع التجارب وتُحفظ.` } };
}

// ---------- Data quality ----------
export interface DataQualityIssue { code: string; label: BiText; severity: 'INFO' | 'WARN' | 'CRITICAL'; }
export interface DataQualitySection { kind: 'dataQuality'; summary: BiText; issues: DataQualityIssue[]; }
export function buildDataQuality(acc: SeedAccount): DataQualitySection {
  const issues: DataQualityIssue[] = [];
  const ageDays = Math.round((Date.now() - Date.parse(acc.freshnessAt)) / 86_400_000);
  if (acc.dataQuality.staleSync || ageDays >= 3) issues.push({ code: 'STALE_SYNC', label: { en: `Data is ${ageDays}d old — refresh before acting.`, ar: `البيانات عمرها ${ageDays} يوم — حدّثها قبل اتخاذ إجراء.` }, severity: 'WARN' });
  if (acc.dataQuality.missingCogs || (acc.commerce && acc.commerce.cogsMinor == null)) issues.push({ code: 'MISSING_COGS', label: { en: 'COGS unknown — profit/margin withheld (never inferred).', ar: 'COGS غير معروف — يُحجب الربح/الهامش (لا يُستنتج).' }, severity: 'WARN' });
  if (acc.dataQuality.attributionMismatch) issues.push({ code: 'ATTRIBUTION_MISMATCH', label: { en: 'Platform-vs-merchant revenue variance present — review attribution.', ar: 'يوجد تباين بين إيراد المنصّة والمتجر — راجع الإسناد.' }, severity: 'WARN' });
  return { kind: 'dataQuality', issues, summary: { en: issues.length ? `${issues.length} data-quality issue(s) — these are data problems, not business-performance problems.` : 'No data-quality issues detected.', ar: issues.length ? `${issues.length} مشكلة جودة بيانات — هذه مشكلات بيانات وليست أداءً تجاريًا.` : 'لا مشكلات جودة بيانات.' } };
}

// ---------- Portfolio (agency) ----------
export interface PortfolioRow { clientId: string; clientName: string; accountId: string; currency: string; attentionScore: number; reasons: BiText[]; }
export interface PortfolioSection { kind: 'portfolio'; summary: BiText; rows: PortfolioRow[]; note: BiText; }
export function buildPortfolio(portfolio: SeedClient[] = SEED_PORTFOLIO): PortfolioSection {
  const rows: PortfolioRow[] = portfolio.map((cl) => {
    const acc = cl.account;
    const reasons: BiText[] = [];
    let score = 0;
    const dq = buildDataQuality(acc);
    if (dq.issues.some((i) => i.code === 'STALE_SYNC')) { score += 30; reasons.push({ en: 'Stale data sync', ar: 'مزامنة بيانات قديمة' }); }
    const cpaTrend = acc.campaigns.length ? classifyTrend(dailyCpa(acc.campaigns[0]!)) : null;
    if (cpaTrend && cpaTrend.direction === 'up' && cpaTrend.state !== 'NOISE') { score += 40; reasons.push({ en: 'CPA deteriorating on the largest campaign', ar: 'تدهور CPA في أكبر حملة' }); }
    if (acc.campaigns.some((c) => c.dominantCreativeFatigue === 'FATIGUE_SIGNAL' || c.dominantCreativeFatigue === 'STRONG_FATIGUE_SIGNAL')) { score += 20; reasons.push({ en: 'Creative fatigue signal', ar: 'إشارة إجهاد إبداعي' }); }
    const commerce = buildCommerce(acc);
    if (commerce.available && (commerce.reconciliation?.state === 'MATERIAL_VARIANCE')) { score += 25; reasons.push({ en: 'Platform-vs-merchant variance', ar: 'تباين المنصّة مقابل المتجر' }); }
    const pendingOutcome = acc.outcomes.some((o) => o.outcomeClass === 'OUTCOME_PENDING');
    if (pendingOutcome) { score += 10; reasons.push({ en: 'Recommendation outcome pending', ar: 'نتيجة توصية معلّقة' }); }
    return { clientId: cl.id, clientName: cl.name, accountId: acc.accountId, currency: cl.reportingCurrency, attentionScore: score, reasons };
  }).sort((a, b) => b.attentionScore - a.attentionScore);
  return { kind: 'portfolio', rows, summary: { en: `${rows.length} clients ranked by deterministic attention score. "${rows[0]?.clientName}" needs attention first.`, ar: `${rows.length} عملاء مرتبون بدرجة انتباه حتمية. "${rows[0]?.clientName}" يحتاج الانتباه أولًا.` }, note: { en: 'Currencies are never blended into one fake total; each client keeps its own currency.', ar: 'لا تُدمج العملات في إجمالي واحد زائف؛ يحتفظ كل عميل بعملته.' } };
}

// ---------- Breakdown (placement / device / geography / audience) ----------
export interface BreakdownSection { kind: 'breakdown'; summary: BiText; provider: string; analyses: BreakdownAnalysis[]; }
export function buildBreakdown(acc: SeedAccount): BreakdownSection {
  const provider = 'meta';
  const dims = [...new Set(acc.breakdowns.map((b) => b.dimension))] as BreakdownDimension[];
  const analyses = dims.map((dim) => analyzeBreakdown(provider, dim, acc.breakdowns.filter((b) => b.dimension === dim) as BreakdownRow[]));
  const supported = analyses.filter((a) => a.supported).length;
  return { kind: 'breakdown', provider, analyses, summary: { en: supported ? `${supported} breakdown dimension(s) analysed on ${provider} (placement/device/geo/audience); protected dimensions reported but never turned into a targeting cut.` : `No supported breakdown for ${provider}.`, ar: supported ? `تم تحليل ${supported} أبعاد تصنيف على ${provider}؛ الأبعاد المحمية تُعرض ولا تُحوّل إلى استبعاد استهداف.` : `لا تصنيف مدعوم لـ ${provider}.` } };
}

// ---------- Cross-channel comparison ----------
export interface CrossChannelSection { kind: 'crossChannel'; summary: BiText; roas: CrossChannelComparison; cpa: CrossChannelComparison; }
export function buildCrossChannel(acc: SeedAccount): CrossChannelSection {
  const toSummary = (c: SeedAccount['channels'][number]): ChannelSummary => ({ provider: c.provider, currency: c.currency, attributionBasis: c.attributionBasis, conversionDefinition: c.conversionDefinition, dateRange: WINDOW, timezone: acc.timezone, trustTier: 'PLATFORM_REPORTED', metrics: { spend: c.spend, conversions: c.conversions, conversion_value: c.conversion_value, roas: c.roas, cpa: c.cpa } });
  const a = acc.channels[0] ? toSummary(acc.channels[0]) : undefined;
  const b = acc.channels[1] ? toSummary(acc.channels[1]) : undefined;
  const empty: CrossChannelComparison = { comparability: { state: 'NOT_COMPARABLE', reasons: ['fewer than two channels'], matched: [], differed: [] } };
  const roas = a && b ? compareChannels(a, b, 'roas') : empty;
  const cpa = a && b ? compareChannels(a, b, 'cpa') : empty;
  return { kind: 'crossChannel', roas, cpa, summary: { en: `Cross-channel comparison (${acc.channels.map((c) => c.provider).join(' vs ')}): ROAS ${roas.comparability.state}${roas.caveat ? ' — ' + roas.caveat.en : ''}. Conversion definitions differ, so compare with care.`, ar: `مقارنة عبر القنوات (${acc.channels.map((c) => c.provider).join(' مقابل ')}): ROAS ${roas.comparability.state}. تعريفات التحويل مختلفة، قارن بحذر.` } };
}

export type AnswerSection =
  | PacingSection | AnomalySection | ForecastSection | TrendSection | ResponseSection | ScalingSection
  | ScenarioSection | CreativeSection | CommerceSection | OutcomesSection | MemorySection | ExperimentsSection
  | DataQualitySection | PortfolioSection | BreakdownSection | CrossChannelSection;

/**
 * Map a typed intent to the analytical section that answers it, computed by the real engines over the
 * seed account. Returns undefined for intents answered purely by the composed diagnosis (e.g.
 * PROFITABILITY_DECLINE / DAILY_REVIEW). This is the single dispatcher the Assistant and surfaces share.
 */
export function sectionForIntent(intent: string, acc: SeedAccount, portfolio: SeedClient[] = SEED_PORTFOLIO): AnswerSection | undefined {
  switch (intent) {
    case 'PACING': return buildPacing(acc);
    case 'ANOMALY': return buildAnomaly(acc);
    case 'FORECAST': return buildForecast(acc);
    case 'TREND': case 'SPEND_REPORT': return buildTrend(acc);
    case 'SATURATION': return buildResponse(acc);
    case 'SCALING': return buildScaling(acc);
    case 'BUDGET_SCENARIO': return buildScenario(acc);
    case 'CREATIVE_REVIEW': return buildCreative(acc);
    case 'COMMERCE_PROFIT': return buildCommerce(acc);
    case 'OUTCOMES_HISTORY': return buildOutcomes(acc);
    case 'MEMORY_CONTEXT': return buildMemory(acc);
    case 'EXPERIMENT_SUGGEST': return buildExperiments(acc);
    case 'DATA_QUALITY': return buildDataQuality(acc);
    case 'PORTFOLIO_ATTENTION': return buildPortfolio(portfolio);
    case 'BREAKDOWN': return buildBreakdown(acc);
    case 'CROSS_CHANNEL': return buildCrossChannel(acc);
    default: return undefined;
  }
}
