import 'server-only';
import { analyzeAccount, type AnalyzeInput, type AccountIntelligence } from './analyze';
import { answerQuestion } from './ask';
import { narrateBrief, type Locale, type NarratedAnswer } from './narrate';
import type { AiGateway, ModelRole } from '../ai-gateway';
import type { EngineContext } from '../engine-context';
import type { Recommendation } from './decision-model';

/**
 * Phase 2 production caller (Workstream 0.3). THE single intelligence path: real assistant requests
 * run authenticated tenant context → analyzeAccount (deterministic intelligence) → governed AI gateway
 * (usage/cost/quota/idempotency) → narrated answer. There is no separate fixture-only intelligence
 * path; fixtures/sandbox merely supply the observations (tagged SYNTHETIC), which flow through this
 * same code. When no live model is wired, the gateway's `run` returns the deterministic local
 * narration (recorded as local_fallback, free) — the facts are identical either way.
 */
export interface AnalyzeAndAnswerInput {
  engineContext: EngineContext;
  analyze: AnalyzeInput;
  gateway: AiGateway;
  /** A user question (Phase 2V). When omitted, the morning brief is narrated. */
  question?: string;
  role?: ModelRole;
  feature?: string;
  now?: number;
  /** Optional persistence hook (tenant-scoped). Recommendations are saved before narration. */
  persist?: (organizationId: string, recs: Recommendation[]) => Promise<void>;
}

export interface AnalyzeAndAnswerResult {
  intelligence: AccountIntelligence;
  answer: NarratedAnswer;
  /** True when the answer was produced locally (no live model transport). */
  local: boolean;
}

export async function analyzeAndAnswer(input: AnalyzeAndAnswerInput): Promise<AnalyzeAndAnswerResult> {
  const intelligence = analyzeAccount(input.analyze);
  if (input.persist && intelligence.recommendations.length > 0) {
    await input.persist(input.engineContext.organizationId, intelligence.recommendations);
  }
  const locale: Locale = input.engineContext.locale;
  const feature = input.feature ?? (input.question ? 'ask_markting' : 'morning_brief');

  const answer = await input.gateway.invoke<NarratedAnswer>({
    ctx: input.engineContext,
    role: input.role ?? 'FAST_ANALYSIS',
    feature,
    now: input.now ?? Date.now(),
    run: async () => {
      // No live model transport in Phase 2 → deterministic local narration from the structured
      // intelligence (same facts a model would be handed). Recorded as a free local fallback.
      const narrated = input.question ? answerQuestion(intelligence, input.question, locale) : narrateBrief(intelligence, locale);
      return { value: narrated, usage: { tokensAvailable: false }, localFallback: true };
    },
  });

  return { intelligence, answer, local: answer.local };
}
