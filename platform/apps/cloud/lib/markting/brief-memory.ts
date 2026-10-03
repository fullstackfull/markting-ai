/**
 * Phase 3X — Morning Brief with memory. Adds a clearly-separated HISTORICAL CONTEXT section to the
 * current brief. Historical context (past outcomes, prior similar changes) is labelled as such and is
 * never presented as current live diagnosis, and never as causation — a prior change that preceded a
 * similar move is temporal context, with its past outcome stated honestly (often inconclusive).
 */
import type { BiText } from './intelligence/decision-model';
import type { OutcomeClass } from './outcomes';

export interface PriorOutcomeContext {
  category: string;
  windowLabel: string;
  classification: OutcomeClass;
  /** A short factual descriptor of the prior change (e.g. "budget expansion last month"). */
  descriptor: BiText;
}

export interface HistoricalContextSection {
  title: BiText;
  items: Array<{ text: BiText; label: 'HISTORICAL_OBSERVATION' }>;
}

const CLASS_PHRASE: Record<OutcomeClass, BiText> = {
  POSITIVE: { en: 'the previous outcome aligned positively (not proven causal)', ar: 'توافقت النتيجة السابقة إيجابيًا (بدون إثبات سببية)' },
  NEGATIVE: { en: 'the previous outcome aligned negatively', ar: 'توافقت النتيجة السابقة سلبيًا' },
  NEUTRAL: { en: 'the previous outcome was flat', ar: 'كانت النتيجة السابقة محايدة' },
  INCONCLUSIVE: { en: 'the previous outcome was inconclusive', ar: 'كانت النتيجة السابقة غير حاسمة' },
  INSUFFICIENT_DATA: { en: 'the previous outcome could not be measured', ar: 'تعذّر قياس النتيجة السابقة' },
  CONTAMINATED: { en: 'the previous window was contaminated by another change', ar: 'تلوّثت الفترة السابقة بتغيير آخر' },
  OUTCOME_PENDING: { en: 'the previous outcome is still pending', ar: 'النتيجة السابقة ما زالت معلّقة' },
};

/**
 * Build the historical-context addendum for the brief. Pure: the caller supplies prior outcomes
 * (already fetched + matched by relevance). Each line is explicitly a HISTORICAL_OBSERVATION.
 */
export function historicalContext(priors: PriorOutcomeContext[]): HistoricalContextSection {
  const section: HistoricalContextSection = { title: { en: 'Historical context', ar: 'سياق تاريخي' }, items: [] };
  for (const p of priors.slice(0, 5)) {
    const phrase = CLASS_PHRASE[p.classification];
    section.items.push({
      label: 'HISTORICAL_OBSERVATION',
      text: {
        en: `A similar ${p.category} change (${p.descriptor.en}) was followed by: ${phrase.en}.`,
        ar: `تبع تغييرًا مماثلًا (${p.descriptor.ar}) في فئة ${p.category}: ${phrase.ar}.`,
      },
    });
  }
  return section;
}
