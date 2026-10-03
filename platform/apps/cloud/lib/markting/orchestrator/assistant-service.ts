/**
 * Coherence Program 3 — the orchestrator-backed assistant service.
 *
 * This is the "Ask AI → unified orchestration path" the reassessment found missing: a free-text buyer
 * question is routed (deterministically) to a typed intent, the domain slices are gathered from the
 * available data sources, the orchestrator composes one IntelligenceResult, and the answer is narrated
 * with an explicit source. Security identity comes from the server-derived context, never the question
 * text. No model is required for this to work (it answers deterministically when none is configured).
 */
import type { IntelligenceIntent, IntelligenceRequestContext } from './context';
import type { OrchestratorInput } from './orchestrator';
import { orchestrator } from './orchestrator';
import { answerFromResult, type AssistantAnswer, type ModelNarrator, deterministicNarrator } from './answer';
import type { AnswerSection } from './sections';

/** The domain slices the service feeds to the orchestrator, sourced per deployment/connection state. */
export type GatheredIntelligence = Omit<OrchestratorInput, 'context' | 'intent'>;

/** A data source that assembles domain slices for a context + intent (demo fixtures or live reads). */
export interface IntelligenceGatherer {
  gather(context: IntelligenceRequestContext, intent: IntelligenceIntent): Promise<GatheredIntelligence>;
  /** Optional analytical section answering the specific intent (computed by the real engines). */
  sections?(context: IntelligenceRequestContext, intent: IntelligenceIntent): AnswerSection | undefined;
}

/** The assistant answer enriched with the intent-specific analytical section, when the source has one. */
export type AssistantAnswerWithSection = AssistantAnswer & { intent: IntelligenceIntent; section?: AnswerSection };

/**
 * Deterministic question → intent router. Keyword/bilingual; never an LLM call. Ordered most-specific
 * first so a precise analytical intent wins over the generic "what needs attention" composition. Each
 * intent maps to a REAL analytical computation (a section or the composed diagnosis), not a canned
 * string, so this is routing — not a per-question keyword hack.
 */
const RULES: Array<{ intent: IntelligenceIntent; re: RegExp }> = [
  { intent: 'SATURATION', re: /(saturat|marginal|diminishing|next dollar|تشبّع|هامشي|العائد الحدّي)/i },
  // The flagship cross-domain WHY question composes a diagnosis — it must beat the COMMERCE_PROFIT
  // metric request below, so it is matched first on a causal "why ... down/decline/profit" pattern.
  { intent: 'PROFITABILITY_DECLINE', re: /(why\b.*(profit|profitab|decline|declin|down|drop|fall|fell|worse)|profitab\w*\s+(declin|drop|down|fell)|لماذا.*(ربح|انخفض|تراجع|هبط))/i },
  { intent: 'CROSS_CHANNEL', re: /(cross-?channel|meta vs google|google vs meta|which channel|compare channels|عبر القنوات|أي قناة|قارن القنوات)/i },
  { intent: 'BREAKDOWN', re: /(placement|device|geograph|by (age|gender|region|city|country)|audience|breakdown|segment|تصنيف|الجمهور|الأجهزة|المواضع|حسب)/i },
  { intent: 'PORTFOLIO_ATTENTION', re: /(which client|clients?|portfolio|book of business|across (my )?clients|أي عميل|عملاء|محفظة)/i },
  // COMMERCE_PROFIT is a METRIC request (true profit / margin / MER / refunds / break-even / COGS /
  // merchant-vs-platform) — deliberately NOT a bare "profit" so it does not steal the why-question.
  { intent: 'COMMERCE_PROFIT', re: /(true profit|profit after|contribution|\bmargin\b|refund|\bmer\b|net revenue|break-?even|cogs|merchant|store revenue|platform .* (vs|versus) .* (merchant|store)|الربح الحقيقي|هامش|استرداد|صافي الإيراد|تعادل|متجر)/i },
  { intent: 'BUDGET_SCENARIO', re: /(where should i (put|allocate)|another \$?\d|extra budget|reallocat|allocat|\$1,?000|أين (أضع|أخصص)|ميزانية إضافية|إعادة توزيع)/i },
  { intent: 'SCALING', re: /(scale|scaling|can i (grow|increase)|ready to scale|توسّع|أوسّع|زيادة)/i },
  { intent: 'PACING', re: /(pac(e|ing)|on track|burn|overspend today|وتيرة|المسار|حرق الميزانية)/i },
  { intent: 'FORECAST', re: /(forecast|project|month-?end|end of (the )?month|will i (over|under)spend|توقّع|نهاية الشهر|تنبؤ)/i },
  { intent: 'ANOMALY', re: /(anomal|spike|sudden|drop|alert|شذوذ|قفزة|انخفاض مفاجئ|تنبيه)/i },
  { intent: 'TREND', re: /(trend|over time|week ?over ?week|wow|compare .* (week|period)|اتجاه|عبر الزمن|أسبوع)/i },
  { intent: 'CREATIVE_REVIEW', re: /(creativ|fatigu|hook|angle|cluster|refresh|ad copy|إبداع|إجهاد|تجديد|عنوان)/i },
  { intent: 'OUTCOMES_HISTORY', re: /(what happened|outcome|after (my|the) (last )?rec|previous recommendation|نتيجة|ماذا حدث بعد|التوصية السابقة)/i },
  { intent: 'EXPERIMENT_SUGGEST', re: /(experiment|holdout|a\/b|test idea|تجربة|اختبار)/i },
  { intent: 'DATA_QUALITY', re: /(data quality|stale|sync|missing|tracking|attribution|جودة البيانات|قديم|مفقود|تتبع)/i },
  { intent: 'MEMORY_CONTEXT', re: /(target|business context|my goals|preferences|هدف|سياق|تفضيل)/i },
  { intent: 'SPEND_REPORT', re: /(how much did i spend|what did i spend|spend (last|in)|blended roas|كم أنفقت|الإنفاق)/i },
  { intent: 'CAMPAIGN_DIAGNOSIS', re: /(campaign|why .* cpa|ad ?set|ad ?group|حملة|لماذا .* cpa)/i },
  { intent: 'ACCOUNT_DIAGNOSIS', re: /(account|what's wrong|diagnose|حساب|ما المشكلة|تشخيص)/i },
  { intent: 'DAILY_REVIEW', re: /(attention|today|this morning|what changed|needs|priorit|brief|انتباه|اليوم|مراجعة|ماذا تغيّر|موجز)/i },
];

export function routeIntent(question: string): IntelligenceIntent {
  const q = question.trim();
  for (const r of RULES) if (r.re.test(q)) return r.intent;
  return 'DAILY_REVIEW';
}

export class AssistantIntelligenceService {
  constructor(
    private readonly gatherer: IntelligenceGatherer,
    private readonly narrator: ModelNarrator = deterministicNarrator,
  ) {}

  /** Answer a typed-intent intelligence request (used by the workspace surfaces). */
  async run(context: IntelligenceRequestContext, intent: IntelligenceIntent): Promise<AssistantAnswerWithSection> {
    const slices = await this.gatherer.gather(context, intent);
    const result = orchestrator.compose({ context, intent, ...slices });
    const answer = await answerFromResult(result, this.narrator);
    const section = this.gatherer.sections?.(context, intent);
    return { ...answer, intent, section };
  }

  /** Answer a free-text buyer question by routing it to an intent, then composing + narrating. */
  async ask(context: IntelligenceRequestContext, question: string): Promise<AssistantAnswerWithSection> {
    return this.run(context, routeIntent(question));
  }
}
