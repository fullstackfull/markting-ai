/**
 * Phase 6G — experiment CONTAMINATION, reusing the Phase-3 contamination vocabulary. An experiment's
 * window is VALID only if nothing confounds it; a confounded window yields CONTAMINATED / INVALIDATED /
 * INCONCLUSIVE, never a fabricated causal verdict.
 */
import type { BiText } from '../intelligence/decision-model';
import type { ContaminationType, ContaminationFlag } from '../outcomes';

export type ExperimentValidity = 'VALID' | 'CONTAMINATED' | 'INVALIDATED' | 'INCONCLUSIVE';

/** Phase-6 contamination sources (a superset vocabulary mapped onto Phase-3 types where possible). */
export interface ExperimentContaminationSignal {
  kind: 'overlapping_budget_change' | 'creative_change_outside_treatment' | 'attribution_changed'
    | 'tracking_incident' | 'promotion_change' | 'inventory_disruption' | 'pricing_change' | 'campaign_restructure';
  detail?: string;
}

const MAP: Record<ExperimentContaminationSignal['kind'], ContaminationType> = {
  overlapping_budget_change: 'major_budget_change',
  creative_change_outside_treatment: 'separate_pause',
  attribution_changed: 'attribution_changed',
  tracking_incident: 'tracking_broke',
  promotion_change: 'promotion_started',
  inventory_disruption: 'reporting_basis_changed',
  pricing_change: 'reporting_basis_changed',
  campaign_restructure: 'separate_pause',
};

export interface ExperimentValidityResult {
  validity: ExperimentValidity;
  contamination: ContaminationFlag[];
  conclusion: BiText;
}

/**
 * Classify experiment validity. Any contamination signal → CONTAMINATED; a tracking incident or
 * attribution change → INVALIDATED (the comparison basis itself moved); no signal but thin window →
 * INCONCLUSIVE; otherwise VALID.
 */
export function classifyExperimentValidity(input: {
  signals?: ExperimentContaminationSignal[];
  windowComplete?: boolean;
  sampleSufficient?: boolean;
}): ExperimentValidityResult {
  const signals = input.signals ?? [];
  const contamination: ContaminationFlag[] = signals.map((s) => ({ type: MAP[s.kind], detail: s.detail ?? s.kind }));
  const invalidating = signals.some((s) => s.kind === 'tracking_incident' || s.kind === 'attribution_changed');
  if (invalidating) {
    return { validity: 'INVALIDATED', contamination, conclusion: { en: 'Invalidated: the measurement basis itself changed (tracking/attribution), so no comparison is valid.', ar: 'مُبطَل: تغيّر أساس القياس نفسه (التتبع/الإسناد)، فلا مقارنة صحيحة.' } };
  }
  if (contamination.length > 0) {
    return { validity: 'CONTAMINATED', contamination, conclusion: { en: `Contaminated: the window was confounded (${signals.map((s) => s.kind).join(', ')}). No success/failure claimed.`, ar: `مُلوَّث: تلوّثت الفترة (${signals.map((s) => s.kind).join('، ')}). لا يُدّعى نجاح أو فشل.` } };
  }
  if (input.windowComplete === false || input.sampleSufficient === false) {
    return { validity: 'INCONCLUSIVE', contamination, conclusion: { en: 'Inconclusive: the window is incomplete or the sample is insufficient — read later.', ar: 'غير حاسم: الفترة غير مكتملة أو العينة غير كافية — تُقرأ لاحقًا.' } };
  }
  return { validity: 'VALID', contamination: [], conclusion: { en: 'Valid: no contamination detected in the observation window.', ar: 'صالح: لم يُكتشف تلوّث في نافذة الملاحظة.' } };
}
