/**
 * Phase 2V — "Ask Markting AI". Routes a natural-language question to the relevant STRUCTURED finding
 * in AccountIntelligence and returns an evidence-cited answer. The routing is intent-matching over the
 * question (keywords, bilingual) to pick which deterministic finding answers it; the answer text and
 * every number come from the structured object, never invented. If the structured intelligence lacks
 * sufficient evidence for the question, the answer says so (INSUFFICIENT_EVIDENCE) rather than guessing.
 */
import type { AccountIntelligence } from './analyze';
import { narrateBrief, type Locale, type NarratedAnswer } from './narrate';
import type { Diagnosis, EvidenceRef } from './decision-model';

export type QuestionIntent =
  | 'WHY_CPA' | 'WHY_ROAS' | 'WHAT_CHANGED' | 'WHICH_CAMPAIGN_HURT' | 'WHERE_OVERSPENDING'
  | 'WHICH_NEED_REVIEW' | 'CAN_WE_SCALE' | 'CHANNEL_COMPARISON' | 'GENERAL_BRIEF';

// Specific entity-oriented intents are matched BEFORE the generic "why CPA/ROAS" ones, so
// "Which campaign hurt ROAS?" routes to the campaign contributor, not the ROAS explainer.
const PATTERNS: Array<{ intent: QuestionIntent; re: RegExp }> = [
  { intent: 'WHICH_CAMPAIGN_HURT', re: /which campaign|أي حملة|campaign.*(hurt|worse|responsible)/i },
  { intent: 'WHICH_NEED_REVIEW', re: /need (review|attention)|تحتاج (مراجعة|انتباه)|which campaigns need/i },
  { intent: 'WHERE_OVERSPENDING', re: /overspend|over.?pacing|إنفاق زائد|أين ننفق/i },
  { intent: 'CAN_WE_SCALE', re: /scale|enough data|توسيع|نتوسع|بيانات كافية/i },
  { intent: 'CHANNEL_COMPARISON', re: /compare|\bvs\b|مقارنة|قارن|meta.*google|google.*meta/i },
  { intent: 'WHAT_CHANGED', re: /what changed|this week|ما الذي تغيّر|هذا الأسبوع/i },
  { intent: 'WHY_CPA', re: /\bcpa\b|cost per (acquisition|conversion)|تكلفة (الاكتساب|التحويل)/i },
  { intent: 'WHY_ROAS', re: /\broas\b|return on ad|العائد على الإنفاق/i },
];

export function classifyQuestion(q: string): QuestionIntent {
  for (const p of PATTERNS) if (p.re.test(q)) return p.intent;
  return 'GENERAL_BRIEF';
}

function diagnosesOfType(intel: AccountIntelligence, types: string[]): Diagnosis[] {
  return [...intel.accountDiagnoses, ...intel.campaigns.flatMap((c) => c.diagnoses)].filter((d) => types.includes(d.type));
}

function answerFrom(intel: AccountIntelligence, locale: Locale, ds: Diagnosis[], emptyEn: string, emptyAr: string): NarratedAnswer {
  if (ds.length === 0) {
    return { locale, text: locale === 'ar' ? emptyAr : emptyEn, evidence: [], local: true };
  }
  const evidence: EvidenceRef[] = ds.flatMap((d) => d.evidence);
  const text = ds.map((d) => `• ${d.summary[locale]}`).join('\n');
  return { locale, text, evidence, local: true };
}

export function answerQuestion(intel: AccountIntelligence, question: string, locale: Locale): NarratedAnswer & { intent: QuestionIntent } {
  const intent = classifyQuestion(question);
  const ins = { en: 'There is not enough trustworthy evidence to answer that confidently yet.', ar: 'لا توجد أدلة كافية وموثوقة للإجابة بثقة بعد.' };
  switch (intent) {
    case 'WHY_CPA': return { ...answerFrom(intel, locale, diagnosesOfType(intel, ['CPA_DETERIORATION', 'CPA_IMPROVEMENT']), ins.en, ins.ar), intent };
    case 'WHY_ROAS': return { ...answerFrom(intel, locale, diagnosesOfType(intel, ['ROAS_DETERIORATION', 'ROAS_IMPROVEMENT']), ins.en, ins.ar), intent };
    case 'WHAT_CHANGED': return { ...answerFrom(intel, locale, diagnosesOfType(intel, ['SPEND_INCREASE', 'SPEND_DECREASE', 'CONVERSION_VOLUME_DECLINE', 'CONVERSION_VOLUME_INCREASE', 'CPA_DETERIORATION', 'ROAS_DETERIORATION']), ins.en, ins.ar), intent };
    case 'WHERE_OVERSPENDING': return { ...answerFrom(intel, locale, diagnosesOfType(intel, ['OVERSPEND_VS_PACING', 'SPEND_INCREASE']), 'No overspending detected against pacing.', 'لا يوجد إنفاق زائد مقابل وتيرة الخطة.'), intent };
    case 'WHICH_CAMPAIGN_HURT': {
      const top = intel.contribution[0];
      if (!top) return { locale, text: locale === 'ar' ? ins.ar : ins.en, evidence: [], local: true, intent };
      return { locale, text: locale === 'ar' ? `أكبر مساهم في الحركة: ${top.name} (${top.sharePct}% من الحركة).` : `Largest contributor to the movement: ${top.name} (${top.sharePct}% of the move).`, evidence: [], local: true, intent };
    }
    case 'WHICH_NEED_REVIEW': {
      const recs = intel.recommendations.filter((r) => r.status === 'REVIEWABLE');
      const text = recs.length ? recs.map((r) => `• ${r.entityScope.name}: ${r.reasoning[locale]}`).join('\n') : (locale === 'ar' ? 'لا توجد عناصر جاهزة للمراجعة الآن.' : 'Nothing is review-ready right now.');
      return { locale, text, evidence: recs.flatMap((r) => r.evidence), local: true, intent };
    }
    case 'CAN_WE_SCALE': {
      const scalable = intel.recommendations.filter((r) => r.actionType === 'REVIEW_BUDGET_SCALE');
      const text = scalable.length ? scalable.map((r) => `• ${r.entityScope.name}: ${r.reasoning[locale]}`).join('\n') : (locale === 'ar' ? 'لا توجد حملات تستوفي معايير التوسيع بأدلة كافية الآن.' : 'No campaigns meet the scaling criteria with sufficient evidence right now.');
      return { locale, text, evidence: scalable.flatMap((r) => r.evidence), local: true, intent };
    }
    case 'CHANNEL_COMPARISON':
      // Cross-channel comparison requires multi-provider data + the comparability gate (cross-channel.ts).
      return { locale, text: locale === 'ar' ? 'مقارنة القنوات تتطلب بيانات من أكثر من مزوّد وتخضع لبوابة قابلية المقارنة (العملة/الإسناد/النطاق الزمني).' : 'A channel comparison needs multi-provider data and passes the comparability gate (currency/attribution/date range).', evidence: [], local: true, intent };
    default:
      return { ...narrateBrief(intel, locale), intent };
  }
}
