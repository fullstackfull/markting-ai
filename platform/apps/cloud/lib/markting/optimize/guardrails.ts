/**
 * Phase 6F — GUARDRAIL metrics. Guardrails constrain recommendation QUALITY and define stop conditions;
 * they do NOT authorize execution. Each guardrail is a typed threshold; evaluation reports whether a
 * (hypothetical/observed) value would breach it, so an option that would trip a guardrail is flagged.
 */
import type { BiText } from '../intelligence/decision-model';

export const GUARDRAIL_METRICS = [
  'CPA_CEILING', 'ROAS_FLOOR', 'BUDGET_CEILING', 'CONTRIBUTION_MARGIN_FLOOR',
  'REFUND_RATE_CEILING', 'FREQUENCY_CEILING', 'SPEND_EXPOSURE_CEILING', 'TRACKING_HEALTH_REQUIRED',
] as const;
export type GuardrailMetric = (typeof GUARDRAIL_METRICS)[number];

export interface Guardrail {
  metric: GuardrailMetric;
  /** Numeric threshold (minor units for money, ratio for rates/ROAS, count for frequency). */
  threshold?: number;
  currency?: string;
  /** For TRACKING_HEALTH_REQUIRED: the minimum health state required. */
  requireHealthy?: boolean;
}

export interface GuardrailBreach { metric: GuardrailMetric; detail: BiText }

/** Evaluate a set of guardrails against observed/hypothetical values. Returns breaches (never executes). */
export function evaluateGuardrails(guardrails: Guardrail[], values: {
  cpa?: number; roas?: number; budget?: { minorUnits: number; currency: string };
  contributionMarginPct?: number; refundRate?: number; frequency?: number;
  spendExposure?: { minorUnits: number; currency: string }; trackingHealthy?: boolean;
}): GuardrailBreach[] {
  const breaches: GuardrailBreach[] = [];
  const bi = (en: string, ar: string): BiText => ({ en, ar });
  for (const g of guardrails) {
    switch (g.metric) {
      case 'CPA_CEILING':
        if (g.threshold != null && values.cpa != null && values.cpa > g.threshold) breaches.push({ metric: g.metric, detail: bi(`CPA ${values.cpa} exceeds ceiling ${g.threshold}`, `CPA ${values.cpa} يتجاوز السقف ${g.threshold}`) });
        break;
      case 'ROAS_FLOOR':
        if (g.threshold != null && values.roas != null && values.roas < g.threshold) breaches.push({ metric: g.metric, detail: bi(`ROAS ${values.roas} below floor ${g.threshold}`, `ROAS ${values.roas} أقل من الحد ${g.threshold}`) });
        break;
      case 'BUDGET_CEILING':
        if (g.threshold != null && values.budget && values.budget.currency === g.currency && values.budget.minorUnits > g.threshold) breaches.push({ metric: g.metric, detail: bi('budget exceeds ceiling', 'الميزانية تتجاوز السقف') });
        break;
      case 'CONTRIBUTION_MARGIN_FLOOR':
        if (g.threshold != null && values.contributionMarginPct != null && values.contributionMarginPct < g.threshold) breaches.push({ metric: g.metric, detail: bi(`contribution margin ${values.contributionMarginPct}% below floor ${g.threshold}%`, `هامش المساهمة ${values.contributionMarginPct}% أقل من الحد ${g.threshold}%`) });
        break;
      case 'REFUND_RATE_CEILING':
        if (g.threshold != null && values.refundRate != null && values.refundRate > g.threshold) breaches.push({ metric: g.metric, detail: bi(`refund rate ${Math.round(values.refundRate * 100)}% exceeds ceiling`, `معدل الاسترداد ${Math.round(values.refundRate * 100)}% يتجاوز السقف`) });
        break;
      case 'FREQUENCY_CEILING':
        if (g.threshold != null && values.frequency != null && values.frequency > g.threshold) breaches.push({ metric: g.metric, detail: bi(`frequency ${values.frequency} exceeds ceiling ${g.threshold}`, `التكرار ${values.frequency} يتجاوز السقف`) });
        break;
      case 'SPEND_EXPOSURE_CEILING':
        if (g.threshold != null && values.spendExposure && values.spendExposure.currency === g.currency && values.spendExposure.minorUnits > g.threshold) breaches.push({ metric: g.metric, detail: bi('spend exposure exceeds limit', 'التعرّض للإنفاق يتجاوز الحد') });
        break;
      case 'TRACKING_HEALTH_REQUIRED':
        if (g.requireHealthy && values.trackingHealthy === false) breaches.push({ metric: g.metric, detail: bi('tracking health is degraded', 'صحة التتبع متدهورة') });
        break;
    }
  }
  return breaches;
}
