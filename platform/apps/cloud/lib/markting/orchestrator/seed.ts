/**
 * Coherence-2 — a rich, CLEARLY SYNTHETIC seed portfolio used to demonstrate the full daily-use product
 * on real engines with no live credentials. Every figure is fabricated demo data; the orchestrator runs
 * the actual deterministic engines over it (pacing, anomaly, forecast, trend, response-curve, scaling,
 * allocation, MER/margin/reconciliation), so answers are genuine computations with inspectable evidence
 * — not hard-coded strings. The trust tier is SYNTHETIC throughout so nothing reads as live.
 *
 * Kept deliberately simple (plain number series + aggregates) so sections feed the engines directly
 * without reconstructing the heavy provider Order/Creative objects.
 */

export type CampaignRole = 'acquisition' | 'brand' | 'strategic' | 'retention';

export interface SeedCampaign {
  id: string;
  name: string;
  role: CampaignRole;
  currency: string;
  /** Daily series, oldest→newest, one entry per day of the period. */
  dailySpendMinor: number[];
  dailyConversions: number[];
  dailyClicks: number[];
  dailyImpressions: number[];
  dailyRevenueMinor: number[];
  budgetMinor: number;
  targetRoas?: number;
  targetKnown: boolean;
  dominantCreativeFatigue: 'NO_SIGNAL' | 'WATCH' | 'FATIGUE_SIGNAL' | 'STRONG_FATIGUE_SIGNAL';
  inventoryRisk?: boolean;
}

export interface SeedCreative {
  id: string;
  name: string;
  campaignId: string;
  hook: string;
  angle: string;
  format: 'video' | 'image' | 'carousel';
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** CTR per day (%), oldest→newest — fatigue shows as a declining CTR with rising frequency. */
  ctrSeries: number[];
  frequencySeries: number[];
  firstSeenDaysAgo: number;
}

export interface SeedCommerce {
  currency: string;
  grossMinor: number;
  refundsMinor: number;
  refundCount: number;
  orderCount: number;
  adSpendMinor: number;
  /** COGS is deliberately UNKNOWN (null) for one client to prove the product never fabricates profit. */
  cogsMinor: number | null;
  platformRevenueMinor: number;
  merchantRevenueMinor: number;
  aovMinorNow: number;
  aovMinorPrev: number;
  newCustomers: number;
}

export interface SeedOutcome {
  recommendationId: string;
  category: string;
  titleEn: string;
  titleAr: string;
  status: 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  executed: boolean;
  outcomeClass: 'OUTCOME_PENDING' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'INCONCLUSIVE' | 'CONTAMINATED';
  causalStance: 'NOT_ESTABLISHED' | 'OUTCOME_ALIGNED_WITH_RECOMMENDATION' | 'TEMPORAL_ASSOCIATION' | 'CAUSAL_EXPERIMENT_SUPPORTED';
  contamination: string[];
}

export interface SeedMemoryItem {
  key: string;
  valueEn: string;
  valueAr: string;
  source: string;
  trust: 'EXPLICIT_HUMAN' | 'CONNECTED_SOURCE' | 'DERIVED';
  dateIso: string;
  revoked?: boolean;
}

export interface SeedExperiment {
  id: string;
  titleEn: string;
  titleAr: string;
  state: 'PROPOSED' | 'ACTIVE' | 'CONCLUDED';
  hypothesisEn: string;
  hypothesisAr: string;
  readiness: 'READY' | 'EXPERIMENT_NOT_READY' | 'NOT_EVALUABLE';
}

export interface SeedAccount {
  accountId: string;
  provider: string;
  reportingCurrency: string;
  timezone: string;
  freshnessAt: string;
  periodDaysElapsed: number;
  periodDays: number;
  campaigns: SeedCampaign[];
  creatives: SeedCreative[];
  commerce: SeedCommerce | null;
  outcomes: SeedOutcome[];
  memory: SeedMemoryItem[];
  experiments: SeedExperiment[];
  /** Explicit data-quality conditions seeded for the Data Quality Center. */
  dataQuality: { staleSync?: boolean; mixedCurrency?: boolean; missingCogs?: boolean; attributionMismatch?: boolean };
  /** Breakdown rows (placement/device/geography/audience_segment) for the breakdown engine. */
  breakdowns: Array<{ dimension: string; value: string; spend: number; conversions?: number; conversion_value?: number; currency?: string }>;
  /** Per-channel summaries for the cross-channel comparison engine. */
  channels: Array<{ provider: string; currency: string; spend: number; conversions: number; conversion_value: number; roas: number; cpa: number; attributionBasis?: string; conversionDefinition?: string }>;
}

export interface SeedClient {
  id: string;
  name: string;
  reportingCurrency: string;
  account: SeedAccount;
}

// ---- deterministic series helpers (no randomness — reproducible) ----
const ramp = (from: number, to: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));
const flat = (v: number, n: number): number[] => Array.from({ length: n }, () => v);

const DAYS = 28;

/** The primary demo account: an e-commerce acquisition story with a profitability decline. */
function primaryAccount(): SeedAccount {
  return {
    accountId: 'sandbox:acc:ramadan',
    provider: 'sandbox',
    reportingCurrency: 'SAR',
    timezone: 'Asia/Riyadh',
    freshnessAt: '2026-10-03T06:00:00.000Z',
    periodDaysElapsed: 18,
    periodDays: 30,
    campaigns: [
      {
        id: 'sandbox:acc:ramadan:camp:awareness', name: 'Ramadan Awareness - KSA', role: 'acquisition', currency: 'SAR',
        dailySpendMinor: ramp(90000, 160000, DAYS), dailyConversions: ramp(40, 28, DAYS),
        dailyClicks: ramp(2000, 1500, DAYS), dailyImpressions: flat(220000, DAYS),
        dailyRevenueMinor: ramp(520000, 430000, DAYS), budgetMinor: 5000000, targetRoas: 4, targetKnown: true,
        dominantCreativeFatigue: 'FATIGUE_SIGNAL',
      },
      {
        id: 'sandbox:acc:ramadan:camp:brandsearch', name: 'Brand Search - US', role: 'brand', currency: 'SAR',
        dailySpendMinor: flat(30000, DAYS), dailyConversions: flat(22, DAYS),
        dailyClicks: flat(600, DAYS), dailyImpressions: flat(40000, DAYS),
        dailyRevenueMinor: flat(180000, DAYS), budgetMinor: 1000000, targetRoas: 5, targetKnown: true,
        dominantCreativeFatigue: 'NO_SIGNAL',
      },
      {
        id: 'sandbox:acc:ramadan:camp:prospecting', name: 'Prospecting - Gulf', role: 'acquisition', currency: 'SAR',
        dailySpendMinor: flat(60000, DAYS), dailyConversions: ramp(30, 34, DAYS),
        dailyClicks: flat(1400, DAYS), dailyImpressions: flat(150000, DAYS),
        dailyRevenueMinor: ramp(300000, 360000, DAYS), budgetMinor: 2200000, targetRoas: 4, targetKnown: true,
        dominantCreativeFatigue: 'NO_SIGNAL', inventoryRisk: true,
      },
    ],
    creatives: [
      { id: 'cr:1', name: 'Ramadan Lanterns Hook A', campaignId: 'sandbox:acc:ramadan:camp:awareness', hook: 'Lanterns', angle: 'Tradition', format: 'video', spendMinor: 1800000, impressions: 3200000, clicks: 24000, conversions: 520, ctrSeries: ramp(90, 55, DAYS), frequencySeries: ramp(18, 34, DAYS), firstSeenDaysAgo: 40 },
      { id: 'cr:2', name: 'Gift Bundle Hook B', campaignId: 'sandbox:acc:ramadan:camp:awareness', hook: 'Gift bundle', angle: 'Value', format: 'image', spendMinor: 600000, impressions: 900000, clicks: 11000, conversions: 240, ctrSeries: flat(120, DAYS), frequencySeries: flat(12, DAYS), firstSeenDaysAgo: 10 },
      { id: 'cr:3', name: 'Prospecting Carousel', campaignId: 'sandbox:acc:ramadan:camp:prospecting', hook: 'Top sellers', angle: 'Social proof', format: 'carousel', spendMinor: 900000, impressions: 1500000, clicks: 14000, conversions: 300, ctrSeries: flat(95, DAYS), frequencySeries: flat(9, DAYS), firstSeenDaysAgo: 6 },
      { id: 'cr:4', name: 'Brand Search RSA', campaignId: 'sandbox:acc:ramadan:camp:brandsearch', hook: 'Brand', angle: 'Intent', format: 'image', spendMinor: 300000, impressions: 400000, clicks: 6000, conversions: 180, ctrSeries: flat(150, DAYS), frequencySeries: flat(3, DAYS), firstSeenDaysAgo: 120 },
    ],
    commerce: {
      currency: 'SAR', grossMinor: 9800000, refundsMinor: 2156000, refundCount: 140, orderCount: 640,
      adSpendMinor: 3600000, cogsMinor: 4200000, platformRevenueMinor: 11200000, merchantRevenueMinor: 9800000,
      aovMinorNow: 15300, aovMinorPrev: 17800, newCustomers: 410,
    },
    outcomes: [
      { recommendationId: 'o:1', category: 'BUDGET_REVIEW', titleEn: 'Reduce budget on Awareness while CPA elevated', titleAr: 'خفض ميزانية حملة التوعية أثناء ارتفاع CPA', status: 'ACCEPTED', executed: true, outcomeClass: 'POSITIVE', causalStance: 'OUTCOME_ALIGNED_WITH_RECOMMENDATION', contamination: [] },
      { recommendationId: 'o:2', category: 'CREATIVE_REVIEW', titleEn: 'Refresh fatiguing lantern creative', titleAr: 'تجديد الإعلان المُجهد', status: 'ACCEPTED', executed: false, outcomeClass: 'OUTCOME_PENDING', causalStance: 'NOT_ESTABLISHED', contamination: [] },
      { recommendationId: 'o:3', category: 'TARGET_REVIEW', titleEn: 'Raise prospecting budget', titleAr: 'رفع ميزانية الاستكشاف', status: 'REJECTED', executed: false, outcomeClass: 'NEUTRAL', causalStance: 'NOT_ESTABLISHED', contamination: [] },
      { recommendationId: 'o:4', category: 'PAUSE_REVIEW', titleEn: 'Pause low-CTR ad', titleAr: 'إيقاف إعلان منخفض النقر', status: 'ACCEPTED', executed: true, outcomeClass: 'CONTAMINATED', causalStance: 'NOT_ESTABLISHED', contamination: ['promotion_started'] },
    ],
    memory: [
      { key: 'target_roas', valueEn: 'Target ROAS 4.0 (acquisition)', valueAr: 'هدف ROAS 4.0 (الاكتساب)', source: 'owner', trust: 'EXPLICIT_HUMAN', dateIso: '2026-09-01' },
      { key: 'break_even_roas', valueEn: 'Break-even ROAS 2.6', valueAr: 'ROAS التعادل 2.6', source: 'owner', trust: 'EXPLICIT_HUMAN', dateIso: '2026-09-01' },
      { key: 'vertical', valueEn: 'Vertical: e-commerce (gifting)', valueAr: 'القطاع: تجارة إلكترونية (هدايا)', source: 'connector', trust: 'CONNECTED_SOURCE', dateIso: '2026-09-20' },
      { key: 'seasonality', valueEn: 'Ramadan is the peak season', valueAr: 'رمضان هو ذروة الموسم', source: 'derived', trust: 'DERIVED', dateIso: '2026-09-25', revoked: false },
    ],
    experiments: [
      { id: 'x:1', titleEn: 'Lantern vs Gift-bundle hook holdout', titleAr: 'اختبار بين عنوان الفوانيس وحزمة الهدايا', state: 'PROPOSED', hypothesisEn: 'A fresh gift-bundle hook will beat the fatiguing lantern hook on CTR and CPA.', hypothesisAr: 'عنوان حزمة الهدايا الجديد سيتفوق على عنوان الفوانيس المُجهد في CTR وCPA.', readiness: 'EXPERIMENT_NOT_READY' },
    ],
    dataQuality: { missingCogs: false, attributionMismatch: true },
    breakdowns: [
      { dimension: 'placement', value: 'Feed', spend: 1800000, conversions: 420, conversion_value: 7200000, currency: 'SAR' },
      { dimension: 'placement', value: 'Stories', spend: 900000, conversions: 120, conversion_value: 1500000, currency: 'SAR' },
      { dimension: 'placement', value: 'Reels', spend: 900000, conversions: 100, conversion_value: 1100000, currency: 'SAR' },
      { dimension: 'device', value: 'Mobile', spend: 2800000, conversions: 520, conversion_value: 8200000, currency: 'SAR' },
      { dimension: 'device', value: 'Desktop', spend: 800000, conversions: 120, conversion_value: 1600000, currency: 'SAR' },
      { dimension: 'geography', value: 'Riyadh', spend: 1600000, conversions: 320, conversion_value: 5200000, currency: 'SAR' },
      { dimension: 'geography', value: 'Jeddah', spend: 1200000, conversions: 220, conversion_value: 3400000, currency: 'SAR' },
      { dimension: 'geography', value: 'Dammam', spend: 800000, conversions: 100, conversion_value: 1200000, currency: 'SAR' },
      { dimension: 'audience_segment', value: 'Gift shoppers', spend: 2000000, conversions: 420, conversion_value: 7400000, currency: 'SAR' },
      { dimension: 'audience_segment', value: 'Lookalike 2%', spend: 1600000, conversions: 220, conversion_value: 2600000, currency: 'SAR' },
    ],
    channels: [
      { provider: 'meta', currency: 'SAR', spend: 2600000, conversions: 520, conversion_value: 9200000, roas: 3.5, cpa: 5000, attributionBasis: '7d-click', conversionDefinition: 'omni_purchase' },
      { provider: 'google', currency: 'SAR', spend: 1000000, conversions: 240, conversion_value: 5200000, roas: 5.2, cpa: 4166, attributionBasis: '7d-click', conversionDefinition: 'purchase' },
    ],
  };
}

/** A second client with a healthy account and no store connected (commerce NOT available). */
function healthyClientAccount(): SeedAccount {
  return {
    accountId: 'sandbox:acc:electronics', provider: 'sandbox', reportingCurrency: 'AED', timezone: 'Asia/Dubai',
    freshnessAt: '2026-10-03T05:00:00.000Z', periodDaysElapsed: 18, periodDays: 30,
    campaigns: [
      { id: 'sandbox:acc:electronics:camp:pmax', name: 'PMax - Electronics', role: 'acquisition', currency: 'AED', dailySpendMinor: flat(80000, DAYS), dailyConversions: flat(45, DAYS), dailyClicks: flat(1800, DAYS), dailyImpressions: flat(190000, DAYS), dailyRevenueMinor: flat(520000, DAYS), budgetMinor: 2600000, targetRoas: 5, targetKnown: true, dominantCreativeFatigue: 'NO_SIGNAL' },
    ],
    creatives: [
      { id: 'cr:e1', name: 'Electronics Hero', campaignId: 'sandbox:acc:electronics:camp:pmax', hook: 'New arrivals', angle: 'Price', format: 'image', spendMinor: 700000, impressions: 1200000, clicks: 16000, conversions: 420, ctrSeries: flat(133, DAYS), frequencySeries: flat(5, DAYS), firstSeenDaysAgo: 14 },
    ],
    commerce: null,
    outcomes: [],
    memory: [{ key: 'target_roas', valueEn: 'Target ROAS 5.0', valueAr: 'هدف ROAS 5.0', source: 'owner', trust: 'EXPLICIT_HUMAN', dateIso: '2026-09-10' }],
    experiments: [],
    dataQuality: { missingCogs: true },
    breakdowns: [],
    channels: [],
  };
}

/** A third client whose sync is stale (data-quality problem, not a performance problem). */
function staleClientAccount(): SeedAccount {
  return {
    accountId: 'sandbox:acc:fashion', provider: 'sandbox', reportingCurrency: 'EGP', timezone: 'Africa/Cairo',
    freshnessAt: '2026-09-26T05:00:00.000Z', periodDaysElapsed: 18, periodDays: 30,
    campaigns: [
      { id: 'sandbox:acc:fashion:camp:retargeting', name: 'Retargeting - Fashion', role: 'retention', currency: 'EGP', dailySpendMinor: flat(50000, DAYS), dailyConversions: flat(18, DAYS), dailyClicks: flat(900, DAYS), dailyImpressions: flat(90000, DAYS), dailyRevenueMinor: flat(210000, DAYS), budgetMinor: 1600000, targetKnown: false, dominantCreativeFatigue: 'WATCH' },
    ],
    creatives: [],
    commerce: null,
    outcomes: [],
    memory: [],
    experiments: [],
    dataQuality: { staleSync: true },
    breakdowns: [],
    channels: [],
  };
}

export const SEED_PORTFOLIO: SeedClient[] = [
  { id: 'client:gifts', name: 'Gulf Gifts Co.', reportingCurrency: 'SAR', account: primaryAccount() },
  { id: 'client:electronics', name: 'Dubai Electronics', reportingCurrency: 'AED', account: healthyClientAccount() },
  { id: 'client:fashion', name: 'Cairo Fashion', reportingCurrency: 'EGP', account: staleClientAccount() },
];

export const PRIMARY_CLIENT = SEED_PORTFOLIO[0]!;

/** Find a client by account id (surfaces pass an accountId scope). */
export function seedClientForAccount(accountId?: string): SeedClient {
  if (!accountId) return PRIMARY_CLIENT;
  return SEED_PORTFOLIO.find((c) => c.account.accountId === accountId) ?? PRIMARY_CLIENT;
}
