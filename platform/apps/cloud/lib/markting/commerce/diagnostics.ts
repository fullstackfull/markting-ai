/**
 * Phase 5W/5X — PROFIT-AWARE diagnostics and REVIEW-ONLY recommendations.
 *
 * The point of Phase 5: ad-platform metrics must NOT dominate merchant truth. These diagnostics surface
 * exactly the cases where the two disagree (ROAS up but net margin down, platform ROAS strong but
 * refunds high, CPA stable but AOV fell, revenue up but contribution profit down, MER worse than one
 * platform's ROAS suggests). Every recommendation is a typed review label — no endpoint/body, always
 * requiresHumanApproval, never auto-changes budget.
 */
import type { BiText } from '../intelligence/decision-model';
import type { MarginObservation, RevenueObservation, CommerceMoney } from './model';
import type { MER, BlendedCAC } from './metrics';
import type { RefundIntelligence } from './revenue';
import type { ReconciliationResult } from './reconciliation';
import type { BreakEven } from './profit';

export type CommerceDiagnosisType =
  | 'PLATFORM_ROAS_EXCEEDS_MERCHANT' | 'REFUNDS_ERODE_NET_REVENUE' | 'REVENUE_UP_PROFIT_DOWN'
  | 'ROAS_UP_MARGIN_DOWN' | 'CPA_STABLE_AOV_FELL' | 'BELOW_BREAK_EVEN' | 'MER_BELOW_TARGET'
  | 'MATERIAL_RECONCILIATION_VARIANCE' | 'COMMERCE_DATA_GAPS';

export interface CommerceDiagnosis {
  type: CommerceDiagnosisType;
  severity: 'INFO' | 'WATCH' | 'MATERIAL';
  summary: BiText;
  evidence: Record<string, unknown>;
}

export interface DiagnosticInput {
  current?: { revenue?: RevenueObservation; margin?: MarginObservation; mer?: MER; refunds?: RefundIntelligence; aov?: CommerceMoney; platformRoas?: number };
  previous?: { margin?: MarginObservation; aov?: CommerceMoney; platformCpa?: number; revenue?: RevenueObservation };
  reconciliation?: ReconciliationResult;
  breakEven?: BreakEven;
  dataGaps?: string[];
}

export function diagnoseCommerce(input: DiagnosticInput): CommerceDiagnosis[] {
  const out: CommerceDiagnosis[] = [];
  const cur = input.current ?? {};
  const prev = input.previous ?? {};

  // Platform ROAS strong but merchant reconciliation shows platform >> merchant revenue.
  if (input.reconciliation?.state === 'MATERIAL_VARIANCE' && (input.reconciliation.differenceMinor ?? 0) < 0) {
    out.push({ type: 'PLATFORM_ROAS_EXCEEDS_MERCHANT', severity: 'MATERIAL',
      summary: { en: 'Platform-attributed revenue materially exceeds merchant-recorded revenue — platform ROAS likely overstates business performance.', ar: 'الإيراد المنسوب من المنصّة يفوق جوهريًا الإيراد المُسجَّل لدى المتجر — غالبًا تُبالغ ROAS المنصّة في الأداء الفعلي.' },
      evidence: { reconciliation: input.reconciliation.state, differencePct: input.reconciliation.differencePct } });
  }
  // Refunds erode net revenue.
  if (cur.refunds && (cur.refunds.refundRateByValue ?? 0) >= 0.1) {
    out.push({ type: 'REFUNDS_ERODE_NET_REVENUE', severity: (cur.refunds.refundRateByValue ?? 0) >= 0.2 ? 'MATERIAL' : 'WATCH',
      summary: { en: `Refunds are ${Math.round((cur.refunds.refundRateByValue ?? 0) * 100)}% of gross — judging campaigns on gross purchase value overstates success.`, ar: `الاستردادات تعادل ${Math.round((cur.refunds.refundRateByValue ?? 0) * 100)}% من الإجمالي — الحكم على الحملات بقيمة الشراء الإجمالية يبالغ في النجاح.` },
      evidence: { refundRateByValue: cur.refunds.refundRateByValue, refundRateByCount: cur.refunds.refundRateByCount } });
  }
  // ROAS improved but contribution margin deteriorated.
  if (cur.margin?.contributionMarginPct != null && prev.margin?.contributionMarginPct != null
      && cur.platformRoas != null && prev.revenue && cur.revenue
      && cur.margin.contributionMarginPct < prev.margin.contributionMarginPct - 2) {
    out.push({ type: 'ROAS_UP_MARGIN_DOWN', severity: 'MATERIAL',
      summary: { en: 'Contribution margin deteriorated even as platform ROAS looks healthy — profit, not platform ROAS, is the real signal.', ar: 'تراجع هامش المساهمة رغم ظهور ROAS المنصّة جيدًا — الربح وليس ROAS المنصّة هو الإشارة الحقيقية.' },
      evidence: { contributionMarginPctNow: cur.margin.contributionMarginPct, contributionMarginPctPrev: prev.margin.contributionMarginPct } });
  }
  // Revenue up but contribution profit down.
  if (cur.revenue && prev.revenue && !cur.revenue.mixedCurrency && !prev.revenue.mixedCurrency
      && cur.revenue.currency === prev.revenue.currency
      && cur.revenue.netRevenue.minorUnits > prev.revenue.netRevenue.minorUnits
      && cur.margin?.contributionProfit && prev.margin?.contributionProfit
      && cur.margin.contributionProfit.minorUnits < prev.margin.contributionProfit.minorUnits) {
    out.push({ type: 'REVENUE_UP_PROFIT_DOWN', severity: 'MATERIAL',
      summary: { en: 'Revenue rose but contribution profit fell — growth is unprofitable at the current cost structure.', ar: 'ارتفع الإيراد لكن انخفض ربح المساهمة — النمو غير مربح ضمن هيكل التكلفة الحالي.' },
      evidence: { netNow: cur.revenue.netRevenue.minorUnits, netPrev: prev.revenue.netRevenue.minorUnits } });
  }
  // CPA stable but AOV fell.
  if (prev.platformCpa != null && cur.platformRoas != null && cur.aov && prev.aov
      && cur.aov.currency === prev.aov.currency && cur.aov.minorUnits < prev.aov.minorUnits * 0.9) {
    out.push({ type: 'CPA_STABLE_AOV_FELL', severity: 'WATCH',
      summary: { en: 'Average order value fell — even a stable CPA buys less revenue per customer than before.', ar: 'انخفض متوسط قيمة الطلب — حتى مع ثبات CPA، يشتري كل عميل إيرادًا أقل من السابق.' },
      evidence: { aovNow: cur.aov.minorUnits, aovPrev: prev.aov.minorUnits } });
  }
  // Below break-even.
  if (input.breakEven?.state === 'BREAK_EVEN_KNOWN' && cur.mer?.value != null && cur.mer.value < input.breakEven.breakEvenRoas) {
    out.push({ type: 'BELOW_BREAK_EVEN', severity: 'MATERIAL',
      summary: { en: `Blended return (${cur.mer.value}) is below break-even ROAS (${input.breakEven.breakEvenRoas}) — spending is unprofitable at this margin.`, ar: `العائد المدمج (${cur.mer.value}) أقل من ROAS التعادل (${input.breakEven.breakEvenRoas}) — الإنفاق غير مربح عند هذا الهامش.` },
      evidence: { mer: cur.mer.value, breakEvenRoas: input.breakEven.breakEvenRoas } });
  }
  // Data gaps.
  if (input.dataGaps && input.dataGaps.length > 0) {
    out.push({ type: 'COMMERCE_DATA_GAPS', severity: 'WATCH',
      summary: { en: `Profitability is only partially known: ${input.dataGaps.join('; ')}.`, ar: `الربحية معروفة جزئيًا فقط: ${input.dataGaps.join('؛ ')}.` },
      evidence: { gaps: input.dataGaps } });
  }
  return out;
}

// ---- Review-only recommendations (5X) ----
export const COMMERCE_RECOMMENDATION_CATEGORIES = [
  'PROFITABILITY_REVIEW', 'MER_REVIEW', 'REFUND_RATE_REVIEW', 'CAC_REVIEW', 'MARGIN_REVIEW',
  'ATTRIBUTION_RECONCILIATION_REVIEW', 'COMMERCE_DATA_QUALITY_REVIEW',
] as const;
export type CommerceRecommendationCategory = (typeof COMMERCE_RECOMMENDATION_CATEGORIES)[number];

export interface CommerceRecommendation {
  organizationId: string;
  scope: { storeId?: string; accountId?: string; productId?: string };
  category: CommerceRecommendationCategory;
  reasoning: BiText;
  evidence: Record<string, unknown>;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  risk: 'LOW' | 'MODERATE' | 'HIGH';
  dataTrust: 'PLATFORM_REPORTED' | 'VALIDATED' | 'RECONCILED';
  /** Always true — review only; nothing here executes, and NEVER auto-changes budget. */
  requiresHumanApproval: true;
}

export function generateCommerceRecommendations(input: {
  organizationId: string;
  scope?: { storeId?: string; accountId?: string };
  diagnoses: CommerceDiagnosis[];
  cac?: BlendedCAC;
  dataTrust?: CommerceRecommendation['dataTrust'];
}): CommerceRecommendation[] {
  const base = { organizationId: input.organizationId, scope: input.scope ?? {}, dataTrust: input.dataTrust ?? 'PLATFORM_REPORTED', requiresHumanApproval: true as const };
  const recs: CommerceRecommendation[] = [];
  const has = (t: CommerceDiagnosisType) => input.diagnoses.find((d) => d.type === t);

  const refund = has('REFUNDS_ERODE_NET_REVENUE');
  if (refund) recs.push({ ...base, category: 'REFUND_RATE_REVIEW', confidence: 'MEDIUM', risk: 'MODERATE', reasoning: { en: 'Review high-refund products/campaigns before scoring them on gross purchase value.', ar: 'راجع المنتجات/الحملات عالية الاسترداد قبل تقييمها بقيمة الشراء الإجمالية.' }, evidence: refund.evidence });

  if (has('PLATFORM_ROAS_EXCEEDS_MERCHANT') || has('MATERIAL_RECONCILIATION_VARIANCE'))
    recs.push({ ...base, category: 'ATTRIBUTION_RECONCILIATION_REVIEW', confidence: 'MEDIUM', risk: 'LOW', reasoning: { en: 'Platform and merchant revenue differ materially — review attribution/tracking before trusting platform ROAS.', ar: 'يختلف إيراد المنصّة والمتجر جوهريًا — راجع الإسناد/التتبع قبل الوثوق بـ ROAS المنصّة.' }, evidence: { reconciliation: input.diagnoses.find((d) => d.type === 'PLATFORM_ROAS_EXCEEDS_MERCHANT')?.evidence } });

  if (has('REVENUE_UP_PROFIT_DOWN') || has('ROAS_UP_MARGIN_DOWN') || has('BELOW_BREAK_EVEN'))
    recs.push({ ...base, category: 'PROFITABILITY_REVIEW', confidence: 'MEDIUM', risk: 'HIGH', reasoning: { en: 'Profit and platform performance disagree — review spend against contribution profit, not platform ROAS.', ar: 'يختلف الربح عن أداء المنصّة — راجع الإنفاق مقابل ربح المساهمة وليس ROAS المنصّة.' }, evidence: { diagnoses: input.diagnoses.map((d) => d.type) } });

  if (input.cac && input.cac.reliability !== 'UNKNOWN' && input.cac.value)
    recs.push({ ...base, category: 'CAC_REVIEW', confidence: input.cac.reliability === 'KNOWN' ? 'MEDIUM' : 'LOW', risk: 'MODERATE', reasoning: { en: 'Review blended CAC against your target; identity coverage limits precision.', ar: 'راجع تكلفة اكتساب العميل المدمجة مقابل هدفك؛ تغطية الهوية تحدّ من الدقة.' }, evidence: { reliability: input.cac.reliability, newCustomers: input.cac.newCustomers } });

  if (has('COMMERCE_DATA_GAPS'))
    recs.push({ ...base, category: 'COMMERCE_DATA_QUALITY_REVIEW', confidence: 'LOW', risk: 'LOW', reasoning: { en: 'Profitability is partially unknown — connect/verify the missing commerce data before acting.', ar: 'الربحية معروفة جزئيًا — اربط/تحقّق من بيانات التجارة الناقصة قبل اتخاذ إجراء.' }, evidence: has('COMMERCE_DATA_GAPS')!.evidence });

  return recs;
}
