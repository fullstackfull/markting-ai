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

/** The domain slices the service feeds to the orchestrator, sourced per deployment/connection state. */
export type GatheredIntelligence = Omit<OrchestratorInput, 'context' | 'intent'>;

/** A data source that assembles domain slices for a context + intent (demo fixtures or live reads). */
export interface IntelligenceGatherer {
  gather(context: IntelligenceRequestContext, intent: IntelligenceIntent): Promise<GatheredIntelligence>;
}

const EN_PROFIT = /(profit|profitab|margin|refund|mer|roas|net revenue|break-?even)/i;
const AR_PROFIT = /(ربح|ربحية|هامش|استرداد|صافي|تعادل)/;
const EN_ATTENTION = /(attention|wrong|today|this morning|review|what changed|needs|priorit)/i;
const AR_ATTENTION = /(انتباه|اليوم|مراجعة|تغيّر|أولوي|ماذا حدث)/;
const EN_ACCOUNT = /(account|campaign|ad ?set|ad ?group|creative)/i;
const AR_ACCOUNT = /(حساب|حملة|إعلان|مجموعة)/;

/**
 * Deterministic question → intent router. Keyword-based and bilingual; never an LLM call. Defaults to
 * DAILY_REVIEW (the "what needs attention" composition) when the question is open-ended.
 */
export function routeIntent(question: string): IntelligenceIntent {
  const q = question.trim();
  if (EN_PROFIT.test(q) || AR_PROFIT.test(q)) return 'PROFITABILITY_DECLINE';
  if (EN_ACCOUNT.test(q) || AR_ACCOUNT.test(q)) return 'ACCOUNT_DIAGNOSIS';
  if (EN_ATTENTION.test(q) || AR_ATTENTION.test(q)) return 'DAILY_REVIEW';
  return 'DAILY_REVIEW';
}

export class AssistantIntelligenceService {
  constructor(
    private readonly gatherer: IntelligenceGatherer,
    private readonly narrator: ModelNarrator = deterministicNarrator,
  ) {}

  /** Answer a typed-intent intelligence request (used by the workspace surfaces). */
  async run(context: IntelligenceRequestContext, intent: IntelligenceIntent): Promise<AssistantAnswer> {
    const slices = await this.gatherer.gather(context, intent);
    const result = orchestrator.compose({ context, intent, ...slices });
    return answerFromResult(result, this.narrator);
  }

  /** Answer a free-text buyer question by routing it to an intent, then composing + narrating. */
  async ask(context: IntelligenceRequestContext, question: string): Promise<AssistantAnswer & { intent: IntelligenceIntent }> {
    const intent = routeIntent(question);
    const answer = await this.run(context, intent);
    return { ...answer, intent };
  }
}
