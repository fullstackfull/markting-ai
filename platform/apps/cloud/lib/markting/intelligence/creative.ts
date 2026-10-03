/**
 * Phase 2L — creative intelligence FOUNDATION (not full multimodal understanding). It normalizes the
 * creative-level data and computes deterministic structural signals: spend concentration across
 * creatives, performance dispersion, and a FATIGUE_SIGNAL that is explicitly labelled NOT_PROVEN —
 * declining CTR alone is a signal, never proof of fatigue. Ad copy/text is treated as DATA only.
 */
import type { BiText } from './decision-model';

export interface CreativePerf {
  creativeId: string;
  provider: string;
  accountId: string;
  campaignId?: string;
  type?: 'image' | 'video' | 'carousel' | 'text' | 'other';
  /** Untrusted ad copy — DATA only, never interpreted as an instruction. */
  copy?: string;
  firstSeen?: string;
  lastSeen?: string;
  spend: number;
  impressions: number;
  ctr?: number;
  cpa?: number;
  roas?: number;
  frequency?: number;
  /** Recent CTR series (oldest→newest) when available, for a fatigue signal. */
  ctrSeries?: number[];
}

export type FatigueVerdict = 'FATIGUE_SIGNAL' | 'NOT_PROVEN' | 'NO_SIGNAL' | 'INSUFFICIENT_DATA';

export interface CreativeReport {
  creativeCount: number;
  spendHHI: number;
  concentration: 'DIVERSE' | 'MODERATE' | 'CONCENTRATED';
  /** Coefficient of variation of CPA across creatives (dispersion), when computable. */
  cpaDispersion?: number;
  fatigue: Array<{ creativeId: string; verdict: FatigueVerdict; note: BiText }>;
  newVsOld: { newCount: number; oldCount: number; thresholdDays: number };
  notes: BiText[];
}

export interface CreativeOptions {
  /** A creative older than this (days, from firstSeen) is "old". */
  ageThresholdDays?: number;
  /** Minimum impressions before a fatigue read is attempted. */
  minImpressionsForFatigue?: number;
  /** Frequency above which a declining-CTR signal is upgraded from NOT_PROVEN wording. */
  frequencyContext?: number;
  now?: number;
}

export function analyzeCreatives(creatives: CreativePerf[], opts: CreativeOptions = {}): CreativeReport {
  const ageDays = opts.ageThresholdDays ?? 30;
  const minImp = opts.minImpressionsForFatigue ?? 1000;
  const now = opts.now ?? Date.now();
  const totalSpend = creatives.reduce((a, c) => a + c.spend, 0);

  const shares = creatives.map((c) => (totalSpend > 0 ? c.spend / totalSpend : 0));
  const spendHHI = shares.reduce((a, s) => a + s * s, 0);
  const concentration = spendHHI >= 0.5 ? 'CONCENTRATED' : spendHHI >= 0.25 ? 'MODERATE' : 'DIVERSE';

  const cpas = creatives.map((c) => c.cpa).filter((x): x is number => typeof x === 'number' && x > 0);
  let cpaDispersion: number | undefined;
  if (cpas.length >= 2) {
    const mean = cpas.reduce((a, b) => a + b, 0) / cpas.length;
    const sd = Math.sqrt(cpas.reduce((a, b) => a + (b - mean) ** 2, 0) / cpas.length);
    cpaDispersion = mean > 0 ? Math.round((sd / mean) * 100) / 100 : undefined;
  }

  const fatigue = creatives.map((c) => ({ creativeId: c.creativeId, ...fatigueVerdict(c, minImp, opts.frequencyContext) }));

  let newCount = 0, oldCount = 0;
  for (const c of creatives) {
    if (!c.firstSeen) continue;
    const ageMs = now - Date.parse(c.firstSeen);
    if (Number.isFinite(ageMs)) (ageMs > ageDays * 86_400_000 ? oldCount++ : newCount++);
  }

  const notes: BiText[] = [];
  if (concentration === 'CONCENTRATED') notes.push({ en: 'Spend concentrated in few creatives — limited creative diversity.', ar: 'الإنفاق مُركّز في إعلانات قليلة — تنوّع إبداعي محدود.' });
  if (fatigue.some((f) => f.verdict === 'FATIGUE_SIGNAL')) notes.push({ en: 'One or more creatives show a fatigue SIGNAL (not proven) — consider a refresh test.', ar: 'تُظهر إعلانات إشارة إجهاد (غير مثبتة) — يُنصح باختبار تجديد.' });

  return { creativeCount: creatives.length, spendHHI: Math.round(spendHHI * 1000) / 1000, concentration, cpaDispersion, fatigue, newVsOld: { newCount, oldCount, thresholdDays: ageDays }, notes };
}

function fatigueVerdict(c: CreativePerf, minImp: number, freqContext?: number): { verdict: FatigueVerdict; note: BiText } {
  if (c.impressions < minImp || !c.ctrSeries || c.ctrSeries.length < 5) {
    return { verdict: 'INSUFFICIENT_DATA', note: { en: 'Not enough impressions/history for a fatigue read.', ar: 'انطباعات/سجل غير كافٍ لقراءة الإجهاد.' } };
  }
  const first = c.ctrSeries.slice(0, Math.ceil(c.ctrSeries.length / 2));
  const last = c.ctrSeries.slice(Math.ceil(c.ctrSeries.length / 2));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const early = mean(first), recent = mean(last);
  const declining = early > 0 && (recent - early) / early <= -0.2; // ≥20% CTR decline across the window
  if (!declining) return { verdict: 'NO_SIGNAL', note: { en: 'CTR is stable — no fatigue signal.', ar: 'معدل النقر مستقر — لا توجد إشارة إجهاد.' } };
  const highFreq = freqContext != null && c.frequency != null && c.frequency > freqContext;
  // A declining CTR is a SIGNAL. We only elevate to FATIGUE_SIGNAL when repetition context supports it,
  // and even then it is explicitly "signal", never proven causation.
  return highFreq
    ? { verdict: 'FATIGUE_SIGNAL', note: { en: 'CTR declining with high frequency — fatigue SIGNAL (not proven).', ar: 'تراجع معدل النقر مع تكرار مرتفع — إشارة إجهاد (غير مثبتة).' } }
    : { verdict: 'NOT_PROVEN', note: { en: 'CTR declining but cause is uncertain (could be audience/seasonality) — NOT_PROVEN.', ar: 'تراجع معدل النقر لكن السبب غير مؤكد (قد يكون الجمهور/الموسمية) — غير مثبت.' } };
}
