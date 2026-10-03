/**
 * Coherence Program 3.1/3.3 — the real AI answer abstraction with an explicit answer SOURCE.
 *
 * The assistant answers from the deterministic IntelligenceResult. A model (when governed credentials
 * exist) NARRATES that result; it never computes or reorders it, and it may not introduce a number or
 * claim absent from the structured evidence. The answer always declares how it was produced:
 *   LIVE_MODEL        — a governed model narrated the deterministic result;
 *   LOCAL_FALLBACK    — a model was configured but unavailable, so the deterministic narration was used;
 *   DETERMINISTIC_ONLY — no model is configured; the deterministic narration is the answer.
 * A fallback is never dressed up as a live model (reassessment AI P0 #1).
 */
import type { BiText } from '../intelligence/decision-model';
import type { IntelligenceResult } from './envelope';

export type AnswerSource = 'LIVE_MODEL' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_ONLY';

/** A concise, inspectable evidence line behind a claim (no hidden chain-of-thought). */
export interface AnswerEvidence {
  domain: string;
  claim: BiText;
  detail?: Record<string, unknown>;
  dataTrust: string;
}

export interface AssistantAnswer {
  text: BiText;
  source: AnswerSource;
  nextAction: IntelligenceResult['nextAction'];
  nextBestQuestion?: BiText;
  evidence: AnswerEvidence[];
  recommendationIds: string[];
  trustTier: string;
  result: IntelligenceResult;
}

const NEXT_ACTION_LABEL: Record<IntelligenceResult['nextAction'], BiText> = {
  ATTENTION: { en: 'Needs attention now', ar: 'يحتاج انتباهًا الآن' },
  INVESTIGATE: { en: 'Investigate before acting', ar: 'تحقّق قبل اتخاذ إجراء' },
  REVIEW: { en: 'Review the recommendation', ar: 'راجع التوصية' },
  EXPERIMENT: { en: 'Consider an experiment', ar: 'فكّر في إجراء تجربة' },
  MONITOR: { en: 'Monitor for now', ar: 'راقب في الوقت الحالي' },
  NO_ACTION: { en: 'No action needed', ar: 'لا يلزم إجراء' },
  INSUFFICIENT_EVIDENCE: { en: 'Not enough evidence to advise', ar: 'الأدلة غير كافية لتقديم نصيحة' },
};

/**
 * Deterministic bilingual narration of an IntelligenceResult — the authoritative answer content. The
 * model narrator (below) may rephrase this but adds no facts. Lists the headline, the top factors with
 * their trust, the single next action, and the next best question; never invents figures.
 */
export function narrateDeterministic(result: IntelligenceResult): BiText {
  const lines_en: string[] = [result.diagnosis.headline.en];
  const lines_ar: string[] = [result.diagnosis.headline.ar];
  const top = result.diagnosis.factors.slice(0, 3);
  if (top.length) {
    lines_en.push('Key factors (ranked):');
    lines_ar.push('العوامل الرئيسية (مرتبة):');
    for (const f of top) {
      lines_en.push(`• ${f.summary.en} [${f.severity}, ${f.confidence} confidence, ${f.dataTrust}]`);
      lines_ar.push(`• ${f.summary.ar} [${f.severity}، ثقة ${f.confidence}، ${f.dataTrust}]`);
    }
  }
  lines_en.push(`Recommended: ${NEXT_ACTION_LABEL[result.nextAction].en}.`);
  lines_ar.push(`موصى به: ${NEXT_ACTION_LABEL[result.nextAction].ar}.`);
  for (const u of result.diagnosis.unresolved.slice(0, 2)) {
    lines_en.push(`Caveat: ${u.en}`);
    lines_ar.push(`تنبيه: ${u.ar}`);
  }
  if (result.diagnosis.factors.length === 0 && result.nextAction === 'INSUFFICIENT_EVIDENCE') {
    const notConnected = result.domains.filter((d) => d.state === 'NOT_CONNECTED' || d.state === 'BLOCKED_EXTERNAL').map((d) => d.domain);
    if (notConnected.length) {
      lines_en.push(`Connect ${notConnected.join(', ')} to analyse this fully.`);
      lines_ar.push(`اربط ${notConnected.join('، ')} لتحليل هذا بالكامل.`);
    }
  }
  return { en: lines_en.join('\n'), ar: lines_ar.join('\n') };
}

/** A model narrator that may re-phrase the deterministic result. Implementations are governed/server-side. */
export interface ModelNarrator {
  readonly kind: 'live' | 'none';
  narrate(result: IntelligenceResult, deterministic: BiText): Promise<{ text: BiText; source: AnswerSource }>;
}

/** The default narrator: no governed model configured → the deterministic narration IS the answer. */
export const deterministicNarrator: ModelNarrator = {
  kind: 'none',
  async narrate(_result, deterministic) {
    return { text: deterministic, source: 'DETERMINISTIC_ONLY' };
  },
};

/** Build the inspectable evidence list from the composed factors (concise, no chain-of-thought). */
function evidenceFrom(result: IntelligenceResult): AnswerEvidence[] {
  return result.diagnosis.factors.map((f) => ({
    domain: f.domain,
    claim: f.summary,
    detail: f.evidenceDetail,
    dataTrust: f.dataTrust,
  }));
}

/**
 * Produce the assistant's answer from a composed IntelligenceResult, narrated by the supplied narrator
 * (deterministic by default). The returned `source` is honest: a model that fails yields LOCAL_FALLBACK
 * with the deterministic text, never a fake LIVE_MODEL.
 */
export async function answerFromResult(result: IntelligenceResult, narrator: ModelNarrator = deterministicNarrator): Promise<AssistantAnswer> {
  const deterministic = narrateDeterministic(result);
  let text = deterministic;
  let source: AnswerSource = 'DETERMINISTIC_ONLY';
  if (narrator.kind === 'live') {
    try {
      const narrated = await narrator.narrate(result, deterministic);
      text = narrated.text;
      source = narrated.source;
    } catch {
      text = deterministic;
      source = 'LOCAL_FALLBACK';
    }
  }
  return {
    text,
    source,
    nextAction: result.nextAction,
    nextBestQuestion: result.nextBestQuestion,
    evidence: evidenceFrom(result),
    recommendationIds: result.recommendations.map((r) => r.recommendationId),
    trustTier: result.trust.tier,
    result: { ...result, answerSource: source },
  };
}
