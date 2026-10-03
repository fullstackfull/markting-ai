/**
 * Phase 3H — decision-aware "Ask MARKTING AI". Answers memory/history questions and ALWAYS labels each
 * claim as FACT (explicit memory), HISTORICAL_OBSERVATION (a measured past outcome, temporal only),
 * DERIVED_PATTERN (an aggregate signal with its sample size), or CURRENT_RECOMMENDATION. Memory never
 * masquerades as current live data, and historical alignment is never stated as causation. Pure.
 */
import type { MemoryItem } from './memory';
import type { EffectivenessLedger } from './learning';
import type { Locale } from './intelligence/narrate';

export type DecisionIntent = 'WHY_RECOMMENDING' | 'TRIED_SIMILAR' | 'LAST_TIME_BUDGET' | 'DO_I_REJECT_SCALING' | 'POOR_PERFORMERS' | 'KNOWN_PREFERENCES' | 'UNKNOWN';

const PATTERNS: Array<{ intent: DecisionIntent; re: RegExp }> = [
  { intent: 'WHY_RECOMMENDING', re: /why (are you |do you |)recommend|لماذا توصي/i },
  { intent: 'LAST_TIME_BUDGET', re: /last time.*budget|increased budget|آخر مرة.*ميزاني|زدنا الميزاني/i },
  { intent: 'TRIED_SIMILAR', re: /similar before|tried.*before|جربنا.*من قبل|سبق/i },
  { intent: 'DO_I_REJECT_SCALING', re: /reject.*scal|usually reject|aggressive scal|أرفض.*توسيع|عادة أرفض/i },
  { intent: 'POOR_PERFORMERS', re: /performed poorly|worst recommendations|أداء سيئ|أسوأ التوصيات/i },
  { intent: 'KNOWN_PREFERENCES', re: /my preferences|what do you know|known about|تفضيلات|ماذا تعرف/i },
];

export function classifyDecisionQuestion(q: string): DecisionIntent {
  for (const p of PATTERNS) if (p.re.test(q)) return p.intent;
  return 'UNKNOWN';
}

export type ClaimKind = 'FACT' | 'HISTORICAL_OBSERVATION' | 'DERIVED_PATTERN' | 'CURRENT_RECOMMENDATION';
export interface LabeledSegment { kind: ClaimKind; text: string }
export interface LabeledAnswer { intent: DecisionIntent; locale: Locale; segments: LabeledSegment[]; text: string }

export interface DecisionContext {
  memory: MemoryItem[];
  effectiveness: EffectivenessLedger;
}

function L(label: ClaimKind, locale: Locale): string {
  const m: Record<ClaimKind, { en: string; ar: string }> = {
    FACT: { en: 'Fact', ar: 'حقيقة' },
    HISTORICAL_OBSERVATION: { en: 'Historical observation', ar: 'ملاحظة تاريخية' },
    DERIVED_PATTERN: { en: 'Derived pattern', ar: 'نمط مُستنتج' },
    CURRENT_RECOMMENDATION: { en: 'Current recommendation', ar: 'توصية حالية' },
  };
  return locale === 'ar' ? m[label].ar : m[label].en;
}

function finalize(intent: DecisionIntent, locale: Locale, segments: LabeledSegment[]): LabeledAnswer {
  const text = segments.map((s) => `[${L(s.kind, locale)}] ${s.text}`).join('\n');
  return { intent, locale, segments, text };
}

export function answerDecisionQuestion(question: string, ctx: DecisionContext, locale: Locale): LabeledAnswer {
  const intent = classifyDecisionQuestion(question);
  const seg: LabeledSegment[] = [];
  const ins = locale === 'ar' ? 'لا توجد سجلّات كافية للإجابة بعد.' : 'There is not enough history to answer yet.';

  switch (intent) {
    case 'KNOWN_PREFERENCES': {
      const facts = ctx.memory.filter((m) => m.category === 'explicit_fact' || m.category === 'human_preference');
      if (!facts.length) { seg.push({ kind: 'FACT', text: ins }); break; }
      for (const f of facts.slice(0, 10)) seg.push({ kind: 'FACT', text: `${f.key} = ${JSON.stringify(f.value)} (source: ${f.source}, trust: ${f.trust})` });
      break;
    }
    case 'LAST_TIME_BUDGET':
    case 'TRIED_SIMILAR': {
      const b = ctx.effectiveness.byCategory['BUDGET_REVIEW'];
      if (!b || b.outcomeMeasured === 0) { seg.push({ kind: 'HISTORICAL_OBSERVATION', text: ins }); break; }
      seg.push({ kind: 'HISTORICAL_OBSERVATION', text: locale === 'ar'
        ? `من ${b.outcomeMeasured} نتيجة مُقاسة لمراجعات الميزانية: ${b.positiveAligned} متوافقة إيجابيًا، ${b.negativeAligned} سلبية، ${b.inconclusive} غير حاسمة، ${b.contaminated} ملوّثة. (توافق زمني، ليس سببية.)`
        : `Of ${b.outcomeMeasured} measured budget-review outcomes: ${b.positiveAligned} positive-aligned, ${b.negativeAligned} negative, ${b.inconclusive} inconclusive, ${b.contaminated} contaminated. (Temporal alignment, not causation.)` });
      break;
    }
    case 'DO_I_REJECT_SCALING': {
      const b = ctx.effectiveness.byCategory['BUDGET_REVIEW'];
      if (!b || b.made < 5) { seg.push({ kind: 'DERIVED_PATTERN', text: locale === 'ar' ? 'عدد مراجعات الميزانية قليل جدًا لاستنتاج نمط موثوق.' : 'Too few budget reviews to derive a reliable pattern.' }); break; }
      const rate = Math.round((b.rejected / b.made) * 100);
      seg.push({ kind: 'DERIVED_PATTERN', text: locale === 'ar'
        ? `رُفض ${rate}% من ${b.made} مراجعة ميزانية (نمط مُستنتج بحجم عيّنة ${b.made}، ليس قاعدة صارمة).`
        : `${rate}% of ${b.made} budget reviews were rejected (derived pattern over n=${b.made}, not a hard rule).` });
      break;
    }
    case 'POOR_PERFORMERS': {
      const entries = Object.entries(ctx.effectiveness.byCategory).filter(([, s]) => s.negativeAligned > 0).sort((a, b) => b[1].negativeAligned - a[1].negativeAligned);
      if (!entries.length) { seg.push({ kind: 'HISTORICAL_OBSERVATION', text: ins }); break; }
      for (const [cat, s] of entries.slice(0, 5)) seg.push({ kind: 'HISTORICAL_OBSERVATION', text: `${cat}: ${s.negativeAligned}/${s.outcomeMeasured} negative-aligned (n=${s.outcomeMeasured}).` });
      break;
    }
    case 'WHY_RECOMMENDING':
      seg.push({ kind: 'CURRENT_RECOMMENDATION', text: locale === 'ar' ? 'يستند السبب إلى التشخيص الحالي وأدلته (انظر التوصية الحالية ومراجعها).' : 'The reason rests on the current diagnosis and its evidence (see the current recommendation and its evidence refs).' });
      break;
    default:
      seg.push({ kind: 'HISTORICAL_OBSERVATION', text: ins });
  }
  return finalize(intent, locale, seg);
}
