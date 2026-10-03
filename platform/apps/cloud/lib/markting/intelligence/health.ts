/**
 * Phase 2D — campaign health as explicit DIMENSIONS, not a fake single 0–100 score. Each dimension is
 * judged deterministically from an evidence input; the overall state is the worst material dimension,
 * with INSUFFICIENT_DATA when the data cannot support a judgement. Low spend is never read as poor
 * performance (it maps to data_sufficiency / observe, not CRITICAL).
 */
import type { DataTier } from '../data-trust';
import type { BiText, HealthDimension, HealthState } from './decision-model';

export interface HealthInput {
  dataTrust: DataTier;
  windowComplete: boolean;
  fresh: boolean;
  conversions: number;
  minConversions: number;
  /** Pacing status from the pacing engine. */
  pacing?: 'ON_TRACK' | 'OVERPACING' | 'UNDERPACING' | 'NOT_EVALUABLE';
  /** Efficiency vs target: 'BEAT' | 'ON' | 'MISS' | 'UNKNOWN'. */
  efficiencyVsTarget?: 'TARGET_BEAT' | 'TARGET_ON' | 'TARGET_MISS' | 'UNKNOWN';
  /** Conversion quality: did conversion rate hold vs baseline. */
  conversionRateWorsening?: boolean;
  /** Creative freshness signal (from the creative engine). */
  creativeFatigueSignal?: boolean;
  /** Tracking quality: false when spend with zero conversions or broken tracking suspected. */
  trackingOk?: boolean;
  /** Attribution confidence: consistent attribution basis across the compared windows. */
  attributionConsistent?: boolean;
}

export interface DimensionVerdict { dimension: HealthDimension; state: HealthState; note: BiText }
export interface HealthReport { overall: HealthState; dimensions: DimensionVerdict[]; label: BiText }

const RANK: Record<HealthState, number> = { HEALTHY: 0, WATCH: 1, ATTENTION: 2, CRITICAL: 3, INSUFFICIENT_DATA: -1 };

export function assessHealth(input: HealthInput): HealthReport {
  const dims: DimensionVerdict[] = [];
  const dataSufficient = input.dataTrust !== 'SYNTHETIC' && input.dataTrust !== 'UNVERIFIED' && input.windowComplete && input.fresh && input.conversions >= input.minConversions;

  dims.push({ dimension: 'data_sufficiency', state: dataSufficient ? 'HEALTHY' : 'INSUFFICIENT_DATA', note: dataSufficient ? EN_AR('sufficient trustworthy data', 'بيانات كافية وموثوقة') : EN_AR('thin/low-tier/stale/incomplete data', 'بيانات قليلة/منخفضة الموثوقية/قديمة/غير مكتملة') });

  dims.push(dim('tracking_quality', input.trackingOk === false ? 'CRITICAL' : 'HEALTHY', input.trackingOk === false ? EN_AR('tracking looks broken (spend without conversions)', 'يبدو أن التتبّع معطّل (إنفاق دون تحويلات)') : EN_AR('tracking consistent', 'تتبّع متّسق')));

  if (input.pacing) dims.push(dim('pacing', input.pacing === 'OVERPACING' ? 'ATTENTION' : input.pacing === 'UNDERPACING' ? 'WATCH' : input.pacing === 'NOT_EVALUABLE' ? 'INSUFFICIENT_DATA' : 'HEALTHY', EN_AR(`pacing ${input.pacing}`, `وتيرة الإنفاق ${input.pacing}`)));

  if (!dataSufficient) {
    // Without sufficient data, efficiency/conversion-quality are not judged (INSUFFICIENT_DATA).
    dims.push(dim('efficiency', 'INSUFFICIENT_DATA', EN_AR('not enough evidence to judge efficiency', 'أدلة غير كافية لتقييم الكفاءة')));
    dims.push(dim('conversion_quality', 'INSUFFICIENT_DATA', EN_AR('not enough evidence to judge conversion quality', 'أدلة غير كافية لتقييم جودة التحويل')));
  } else {
    const eff = input.efficiencyVsTarget;
    dims.push(dim('efficiency', eff === 'TARGET_MISS' ? 'ATTENTION' : eff === 'UNKNOWN' || eff === undefined ? 'WATCH' : 'HEALTHY', eff === 'UNKNOWN' || eff === undefined ? EN_AR('no target configured; baseline only', 'لا يوجد هدف مُهيّأ؛ مقارنة بالأساس فقط') : EN_AR(`efficiency ${eff}`, `الكفاءة ${eff}`)));
    dims.push(dim('conversion_quality', input.conversionRateWorsening ? 'ATTENTION' : 'HEALTHY', input.conversionRateWorsening ? EN_AR('conversion rate worsening', 'معدل التحويل يتراجع') : EN_AR('conversion rate stable', 'معدل التحويل مستقر')));
  }

  if (input.creativeFatigueSignal != null) dims.push(dim('creative_freshness', input.creativeFatigueSignal ? 'WATCH' : 'HEALTHY', input.creativeFatigueSignal ? EN_AR('possible creative fatigue signal (not proven)', 'إشارة محتملة لإجهاد الإعلان (غير مثبتة)') : EN_AR('no fatigue signal', 'لا توجد إشارة إجهاد')));
  if (input.attributionConsistent != null) dims.push(dim('attribution_confidence', input.attributionConsistent ? 'HEALTHY' : 'WATCH', input.attributionConsistent ? EN_AR('attribution basis consistent', 'أساس الإسناد متّسق') : EN_AR('attribution basis differs across windows', 'أساس الإسناد مختلف بين الفترات')));

  // Overall = worst material dimension. If every judged dimension is INSUFFICIENT_DATA, overall is that.
  const material = dims.filter((d) => d.state !== 'INSUFFICIENT_DATA');
  const overall: HealthState = material.length === 0 ? 'INSUFFICIENT_DATA' : material.reduce<HealthState>((worst, d) => (RANK[d.state] > RANK[worst] ? d.state : worst), 'HEALTHY');
  return { overall, dimensions: dims, label: STATE_LABELS[overall] };
}

function dim(dimension: HealthDimension, state: HealthState, note: BiText): DimensionVerdict { return { dimension, state, note }; }
function EN_AR(en: string, ar: string): BiText { return { en, ar }; }
const STATE_LABELS: Record<HealthState, BiText> = {
  HEALTHY: { en: 'Healthy', ar: 'سليم' },
  WATCH: { en: 'Watch', ar: 'مراقبة' },
  ATTENTION: { en: 'Needs attention', ar: 'يحتاج انتباه' },
  CRITICAL: { en: 'Critical', ar: 'حرج' },
  INSUFFICIENT_DATA: { en: 'Insufficient data', ar: 'بيانات غير كافية' },
};
