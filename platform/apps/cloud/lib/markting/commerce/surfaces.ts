/**
 * Phase 5 — COMMERCE SURFACES. The profit morning brief, "Ask MARKTING AI — Commerce", the
 * profitability dashboard, and the reconciliation dashboard. Every surface SEPARATES the AD PLATFORM
 * VIEW from the MERCHANT VIEW, shows only metrics with sufficient trusted inputs (no false precision),
 * cites the data basis, and is bilingual. No surface emits a number it cannot support.
 */
import type { BiText } from '../intelligence/decision-model';
import type { RevenueObservation, MarginObservation, CommerceMoney } from './model';
import type { MER, BlendedCAC } from './metrics';
import type { RefundIntelligence } from './revenue';
import type { ReconciliationResult } from './reconciliation';
import type { CommerceDiagnosis } from './diagnostics';

function money(m?: CommerceMoney | null): string | null {
  if (!m) return null;
  return `${(m.minorUnits / 100).toFixed(2)} ${m.currency}`;
}

export interface ProfitBrief {
  platformView: { adSpend?: string; platformAttributedRevenue?: string; platformRoas?: number };
  merchantView: { grossSales?: string; netRevenue?: string; refunds?: string; mer?: string; marginKnown: boolean; contributionProfit?: string };
  disagreements: BiText[];          // where platform & merchant numbers diverge
  needsReview: BiText[];
  caveats: BiText[];
}

/** Build the profit morning brief. Any figure lacking trusted inputs is omitted, not faked. */
export function buildProfitBrief(input: {
  adSpend?: CommerceMoney;
  platformAttributedRevenue?: CommerceMoney;
  platformRoas?: number;
  revenue?: RevenueObservation;
  refunds?: RefundIntelligence;
  mer?: MER;
  margin?: MarginObservation;
  reconciliation?: ReconciliationResult;
  diagnoses?: CommerceDiagnosis[];
}): ProfitBrief {
  const disagreements: BiText[] = [];
  if (input.reconciliation && (input.reconciliation.state === 'MATERIAL_VARIANCE' || input.reconciliation.state === 'EXPECTED_VARIANCE')) {
    disagreements.push({ en: `Platform vs merchant revenue: ${input.reconciliation.state} (${input.reconciliation.differencePct ?? '?'}%).`, ar: `إيراد المنصّة مقابل المتجر: ${input.reconciliation.state} (${input.reconciliation.differencePct ?? '؟'}%).` });
  }
  const needsReview = (input.diagnoses ?? []).filter((d) => d.severity !== 'INFO').map((d) => d.summary);
  const caveats: BiText[] = [];
  if (input.margin?.notComputableReason) caveats.push({ en: `Margin not shown: ${input.margin.notComputableReason}.`, ar: `الهامش غير مُعروض: ${input.margin.notComputableReason}.` });
  if (input.mer?.notComputableReason) caveats.push({ en: `MER not shown: ${input.mer.notComputableReason}.`, ar: `MER غير مُعروض: ${input.mer.notComputableReason}.` });
  if (input.revenue?.mixedCurrency) caveats.push({ en: 'Revenue spans multiple currencies — totals are not blended.', ar: 'الإيراد بعملات متعددة — لم تُدمج الإجماليات.' });

  return {
    platformView: {
      adSpend: money(input.adSpend) ?? undefined,
      platformAttributedRevenue: money(input.platformAttributedRevenue) ?? undefined,
      platformRoas: input.platformRoas,
    },
    merchantView: {
      grossSales: money(input.revenue?.grossSales) ?? undefined,
      netRevenue: input.revenue && !input.revenue.mixedCurrency ? money(input.revenue.netRevenue) ?? undefined : undefined,
      refunds: money(input.refunds?.netAfterRefunds ? undefined : undefined) ?? (input.refunds && input.refunds.refundRateByValue != null ? `${Math.round(input.refunds.refundRateByValue * 100)}%` : undefined),
      mer: input.mer?.value != null ? `${input.mer.value} (${input.mer.basis})` : undefined,
      marginKnown: input.margin?.contributionMarginPct != null,
      contributionProfit: money(input.margin?.contributionProfit) ?? undefined,
    },
    disagreements,
    needsReview,
    caveats,
  };
}

// ---- Ask MARKTING AI — Commerce ----
export type CommerceQuestionIntent =
  | 'ACTUAL_REVENUE' | 'MER' | 'PLATFORM_VS_STORE' | 'PRODUCT_PROFIT' | 'REFUND_IMPACT'
  | 'BLENDED_CAC' | 'BREAK_EVEN' | 'DATA_MISSING' | 'UNKNOWN';

export function classifyCommerceQuestion(q: string): CommerceQuestionIntent {
  const s = q.toLowerCase();
  if (/(actually made|real revenue|كم ربحنا|الإيراد الفعلي|how much did we (actually )?make)/.test(s)) return 'ACTUAL_REVENUE';
  if (/\bmer\b|marketing efficiency/.test(s)) return 'MER';
  if (/(roas.*(store|lower|merchant)|meta.*store|منصّة.*المتجر|why does .* say)/.test(s)) return 'PLATFORM_VS_STORE';
  if (/(profitable|profit|margin|ربح|هامش).*(product|منتج)|which products/.test(s)) return 'PRODUCT_PROFIT';
  if (/(refund|استرداد).*(hurt|campaign|حملة)/.test(s)) return 'REFUND_IMPACT';
  if (/(blended )?cac|تكلفة اكتساب/.test(s)) return 'BLENDED_CAC';
  if (/break.?even|التعادل/.test(s)) return 'BREAK_EVEN';
  if (/(missing|what data|ما البيانات|know profitability)/.test(s)) return 'DATA_MISSING';
  return 'UNKNOWN';
}

export interface CommerceAnswer { intent: CommerceQuestionIntent; text: BiText; basis: BiText; cited: string[] }

/** Answer a commerce question, ALWAYS citing the data basis; refuse a number when inputs are missing. */
export function answerCommerceQuestion(q: string, ctx: {
  revenue?: RevenueObservation; mer?: MER; reconciliation?: ReconciliationResult; refunds?: RefundIntelligence; cac?: BlendedCAC; breakEven?: { state: string; breakEvenRoas?: number }; dataGaps?: string[];
}): CommerceAnswer {
  const intent = classifyCommerceQuestion(q);
  const cited: string[] = [];
  let text: BiText; let basis: BiText;
  switch (intent) {
    case 'ACTUAL_REVENUE':
      if (ctx.revenue && !ctx.revenue.mixedCurrency) { cited.push('merchant_net_revenue'); text = { en: `Merchant net revenue was ${(ctx.revenue.netRevenue.minorUnits / 100).toFixed(2)} ${ctx.revenue.currency} (${ctx.revenue.orderCount} orders), not platform-attributed value.`, ar: `صافي إيراد المتجر كان ${(ctx.revenue.netRevenue.minorUnits / 100).toFixed(2)} ${ctx.revenue.currency} (${ctx.revenue.orderCount} طلب)، وليس القيمة المنسوبة من المنصّة.` }; }
      else text = { en: 'Merchant revenue is not available for this window (or spans multiple currencies).', ar: 'إيراد المتجر غير متاح لهذه الفترة (أو بعملات متعددة).' };
      basis = { en: `basis: ${ctx.revenue?.basis.label ?? 'none'}`, ar: `الأساس: ${ctx.revenue?.basis.label ?? 'لا يوجد'}` };
      break;
    case 'MER':
      text = ctx.mer?.value != null ? { en: `MER is ${ctx.mer.value} on a ${ctx.mer.basis}-revenue basis over ${ctx.mer.adSpendScope}.`, ar: `MER يساوي ${ctx.mer.value} على أساس إيراد ${ctx.mer.basis} ضمن ${ctx.mer.adSpendScope}.` } : { en: `MER cannot be computed: ${ctx.mer?.notComputableReason ?? 'missing revenue or ad spend'}.`, ar: `تعذّر حساب MER: ${ctx.mer?.notComputableReason ?? 'نقص الإيراد أو الإنفاق'}.` };
      basis = { en: `basis: ${ctx.mer?.basis ?? 'none'}; scope: ${ctx.mer?.adSpendScope ?? 'none'}`, ar: `الأساس: ${ctx.mer?.basis ?? 'لا يوجد'}` }; cited.push('mer');
      break;
    case 'PLATFORM_VS_STORE':
      text = ctx.reconciliation ? { en: `Platform and merchant revenue reconcile as ${ctx.reconciliation.state} (Δ ${ctx.reconciliation.differencePct ?? '?'}%). Likely reasons: ${ctx.reconciliation.possibleExplanations.slice(0, 3).join(', ') || 'none material'}. This is normal variance, not necessarily an error.`, ar: `يتطابق إيراد المنصّة والمتجر بحالة ${ctx.reconciliation.state} (الفرق ${ctx.reconciliation.differencePct ?? '؟'}%). أسباب محتملة: ${ctx.reconciliation.possibleExplanations.slice(0, 3).join('، ') || 'لا يوجد جوهري'}.` } : { en: 'No reconciliation available — connect both ad-platform and merchant data for the window.', ar: 'لا تسوية متاحة — اربط بيانات المنصّة والمتجر للفترة.' };
      basis = { en: 'basis: platform-attributed vs merchant-recorded', ar: 'الأساس: المنسوب من المنصّة مقابل المُسجَّل لدى المتجر' }; cited.push('reconciliation');
      break;
    case 'REFUND_IMPACT':
      text = ctx.refunds && ctx.refunds.refundRateByValue != null ? { en: `Refunds were ${Math.round(ctx.refunds.refundRateByValue * 100)}% of gross; judge campaigns on net-after-refunds, not gross.`, ar: `الاستردادات ${Math.round(ctx.refunds.refundRateByValue * 100)}% من الإجمالي؛ احكم على الحملات بالصافي بعد الاسترداد.` } : { en: 'Refund data is unavailable or spans currencies.', ar: 'بيانات الاسترداد غير متاحة أو بعملات متعددة.' };
      basis = { en: 'basis: refund records vs gross', ar: 'الأساس: سجلات الاسترداد مقابل الإجمالي' }; cited.push('refunds');
      break;
    case 'BLENDED_CAC':
      text = ctx.cac?.value ? { en: `Blended CAC ≈ ${(ctx.cac.value.minorUnits / 100).toFixed(2)} ${ctx.cac.value.currency} (${ctx.cac.reliability} identity).`, ar: `تكلفة الاكتساب المدمجة ≈ ${(ctx.cac.value.minorUnits / 100).toFixed(2)} ${ctx.cac.value.currency} (هوية ${ctx.cac.reliability}).` } : { en: `Blended CAC cannot be computed: ${ctx.cac?.notComputableReason ?? 'customer identity insufficient'}.`, ar: `تعذّر حساب تكلفة الاكتساب: ${ctx.cac?.notComputableReason ?? 'هوية العميل غير كافية'}.` };
      basis = { en: 'basis: ad spend / identified new customers', ar: 'الأساس: الإنفاق / العملاء الجدد المُعرّفين' }; cited.push('cac');
      break;
    case 'BREAK_EVEN':
      text = ctx.breakEven?.state === 'BREAK_EVEN_KNOWN' ? { en: `Break-even ROAS ≈ ${ctx.breakEven.breakEvenRoas}.`, ar: `ROAS التعادل ≈ ${ctx.breakEven.breakEvenRoas}.` } : { en: 'Break-even is unknown — a trusted contribution margin is required.', ar: 'التعادل غير معروف — يلزم هامش مساهمة موثوق.' };
      basis = { en: 'basis: 1 / contribution-margin fraction', ar: 'الأساس: ١ ÷ نسبة هامش المساهمة' }; cited.push('break_even');
      break;
    case 'DATA_MISSING':
      text = { en: `To know profitability you still need: ${(ctx.dataGaps ?? ['merchant revenue connection', 'product COGS', 'reliable customer identity']).join('; ')}.`, ar: `لمعرفة الربحية تحتاج إلى: ${(ctx.dataGaps ?? ['ربط إيراد المتجر', 'تكلفة البضاعة', 'هوية عميل موثوقة']).join('؛ ')}.` };
      basis = { en: 'basis: data-trust coverage', ar: 'الأساس: تغطية ثقة البيانات' };
      break;
    default:
      text = { en: 'I can answer: actual revenue, MER, platform-vs-store, product profit, refund impact, blended CAC, break-even, or what data is missing.', ar: 'أستطيع الإجابة عن: الإيراد الفعلي، MER، المنصّة مقابل المتجر، ربح المنتج، أثر الاسترداد، تكلفة الاكتساب، التعادل، أو البيانات الناقصة.' };
      basis = { en: 'basis: none', ar: 'الأساس: لا يوجد' };
  }
  return { intent, text, basis, cited };
}

// ---- Profitability dashboard ----
export interface ProfitabilityDashboard {
  tiles: Array<{ key: string; value?: string; shown: boolean; omittedReason?: string }>;
  separation: BiText;
}

/** Show only tiles whose inputs are trusted; omit (with a reason) rather than show false precision. */
export function buildProfitabilityDashboard(input: {
  revenue?: RevenueObservation; adSpend?: CommerceMoney; mer?: MER; refunds?: RefundIntelligence; aov?: CommerceMoney; cac?: BlendedCAC; margin?: MarginObservation;
}): ProfitabilityDashboard {
  const tiles: ProfitabilityDashboard['tiles'] = [];
  const tile = (key: string, value: string | null | undefined, omittedReason?: string) => tiles.push(value != null ? { key, value, shown: true } : { key, shown: false, omittedReason: omittedReason ?? 'insufficient trusted inputs' });
  tile('revenue', input.revenue && !input.revenue.mixedCurrency ? money(input.revenue.grossSales) : null, input.revenue?.mixedCurrency ? 'mixed currency' : undefined);
  tile('net_revenue', input.revenue && !input.revenue.mixedCurrency ? money(input.revenue.netRevenue) : null);
  tile('ad_spend', money(input.adSpend));
  tile('mer', input.mer?.value != null ? `${input.mer.value} (${input.mer.basis})` : null, input.mer?.notComputableReason);
  tile('refund_rate', input.refunds?.refundRateByValue != null ? `${Math.round(input.refunds.refundRateByValue * 100)}%` : null, 'mixed currency or no refund data');
  tile('aov', money(input.aov));
  tile('cac', input.cac?.value ? money(input.cac.value) : null, input.cac?.notComputableReason);
  tile('contribution_profit', money(input.margin?.contributionProfit), input.margin?.notComputableReason);
  tile('contribution_margin_pct', input.margin?.contributionMarginPct != null ? `${input.margin.contributionMarginPct}%` : null, input.margin?.notComputableReason);
  return { tiles, separation: { en: 'Ad-platform view and merchant view are reported separately; they are different numbers.', ar: 'يُعرض رأي المنصّة ورأي المتجر بشكل منفصل؛ وهما رقمان مختلفان.' } };
}

// ---- Reconciliation dashboard ----
export interface ReconciliationDashboard {
  providerAttributedRevenue?: string;
  merchantRevenue?: string;
  difference?: string;
  differencePct?: number;
  state: ReconciliationResult['state'];
  possibleExplanations: string[];
  currency?: string;
  note: BiText;
}

export function buildReconciliationDashboard(r: ReconciliationResult): ReconciliationDashboard {
  return {
    providerAttributedRevenue: money(r.platformRevenue) ?? undefined,
    merchantRevenue: money(r.merchantRevenue) ?? undefined,
    difference: r.differenceMinor != null && r.currency ? money({ minorUnits: r.differenceMinor, currency: r.currency }) ?? undefined : undefined,
    differencePct: r.differencePct,
    state: r.state,
    possibleExplanations: r.possibleExplanations,
    currency: r.currency,
    note: { en: 'A discrepancy does not imply fraud or a tracking error — it is expected variance between attributed and recorded revenue.', ar: 'الاختلاف لا يعني احتيالًا أو خطأ تتبع — إنه تباين متوقع بين الإيراد المنسوب والمُسجَّل.' },
  };
}
