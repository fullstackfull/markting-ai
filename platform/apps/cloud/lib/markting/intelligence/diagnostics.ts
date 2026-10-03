/**
 * Phase 2B/2C — the deterministic diagnostic engine. Code detects the core signal and decomposes it;
 * the LLM only explains the structured result. Every diagnosis is currency-safe, evidence-gated
 * (synthetic/partial/thin/stale/mixed-currency → INSUFFICIENT_EVIDENCE, never a fabricated cause), and
 * carries machine-readable evidence (Phase 2W). CPA/ROAS/CPC movements are decomposed into their
 * multiplicative factors via a log-ratio identity, so "CPA rose mostly because CPM rose" is arithmetic,
 * not a guess. Contribution across factors is reported as a share of the total absolute log movement;
 * it is a decomposition, never a causal claim.
 */
import { aggregate, type Aggregate } from './analysis';
import { evaluateEvidence, type DataTier } from '../data-trust';
import { deriveConfidence } from './confidence';
import type { MetricObservation, CanonicalMetric, EntityLevel } from './model';
import type { BiText, Diagnosis, DiagnosisType, EvidenceRef, Severity, Signal } from './decision-model';

export interface DiagnoseScope { organizationId: string; accountId: string; entityId: string; entityLevel: EntityLevel; name: string }

export interface DiagnoseOptions {
  /** Material move for a ratio metric (CPA/ROAS/CTR/CPM/CPC/CVR), percent. */
  materialPct?: number;
  /** Material move for spend/volume, percent. */
  volumeMaterialPct?: number;
  /** Frequency ceiling is business/provider-specific — NO universal default. If unset, frequency is not diagnosed. */
  frequencyCeiling?: number;
  /** Staleness bound threaded to the evidence floor. */
  staleness?: { asOf?: string; maxAgeMs?: number };
}

const DEFAULTS = { materialPct: 10, volumeMaterialPct: 15 };

function pct(from: number, to: number): number | undefined {
  if (!Number.isFinite(from) || from === 0) return undefined;
  return ((to - from) / Math.abs(from)) * 100;
}
function dirOf(from: number, to: number, eps: number): 'up' | 'down' | 'flat' {
  const p = pct(from, to);
  if (p === undefined || Math.abs(p) < eps) return 'flat';
  return p > 0 ? 'up' : 'down';
}
/** Signed log movement of a factor; undefined when either side is non-positive (log undefined). */
function dln(from: number, to: number): number | undefined {
  if (from > 0 && to > 0) return Math.log(to / from);
  return undefined;
}

/** Decompose a target's log movement into factors; returns signed effect + share of total |movement|. */
export interface FactorShare { factor: string; metric?: CanonicalMetric; dln: number; sharePct: number; direction: 'up' | 'down' }
function decompose(factors: Array<{ factor: string; metric?: CanonicalMetric; dln: number | undefined }>): FactorShare[] | undefined {
  const known = factors.filter((f): f is { factor: string; metric?: CanonicalMetric; dln: number } => typeof f.dln === 'number');
  if (known.length < factors.length || known.length === 0) return undefined; // decomposition only when every factor is defined
  const totalAbs = known.reduce((a, f) => a + Math.abs(f.dln), 0);
  if (totalAbs === 0) return undefined;
  return known.map((f) => ({ factor: f.factor, metric: f.metric, dln: f.dln, sharePct: Math.round((Math.abs(f.dln) / totalAbs) * 1000) / 10, direction: f.dln >= 0 ? 'up' : 'down' }));
}

function derivedFrom(agg: Aggregate) {
  const b = agg.base;
  const spend = b.spend ?? 0, imp = b.impressions ?? 0, clk = b.clicks ?? 0, conv = b.conversions ?? 0, val = b.conversion_value ?? 0;
  return {
    spend, impressions: imp, clicks: clk, conversions: conv, conversion_value: val,
    ctr: imp ? (clk / imp) * 100 : 0,
    cpm: imp ? (spend / imp) * 1000 : 0,
    cpc: clk ? spend / clk : 0,
    cpa: conv ? spend / conv : 0,
    roas: spend ? val / spend : 0,
    cvr: clk ? (conv / clk) * 100 : 0,
    aov: conv ? val / conv : 0,
    frequency: b.frequency,
  };
}

function ref(kind: EvidenceRef['kind'], scope: DiagnoseScope, metric: CanonicalMetric | undefined, periods: Diagnosis['evidence'][number]['periods'], values: EvidenceRef['values'], dataTrust: DataTier, calculation: string, currency?: string, attributionBasis?: string): EvidenceRef {
  return { kind, metric, entityIds: [scope.entityId], entityLevel: scope.entityLevel, periods, values, currency, attributionBasis, dataTrust, calculation };
}

/**
 * Diagnose one entity's period-over-period change. Account-level and campaign-level use the same
 * routine (the scope entity level differs). Returns a prioritized list of diagnoses + the raw signals.
 */
export function diagnoseEntity(input: {
  scope: DiagnoseScope;
  current: MetricObservation[];
  previous: MetricObservation[];
  period: { current: { start: string; end: string }; previous: { start: string; end: string } };
  pacing?: { plannedBudget: number; daysElapsed: number; daysInPeriod: number };
  options?: DiagnoseOptions;
}): { diagnoses: Diagnosis[]; signals: Signal[] } {
  const o = { ...DEFAULTS, ...input.options };
  const cur = aggregate(input.current);
  const prev = aggregate(input.previous);
  const c = derivedFrom(cur);
  const p = derivedFrom(prev);
  const tier = cur.worstTier as DataTier;
  const ccy = cur.currency;
  const attr = input.current[0]?.attribution?.label;
  const attributionConsistent = (input.current[0]?.attribution?.label ?? null) === (input.previous[0]?.attribution?.label ?? null);
  const periods = { current: input.period.current, previous: input.period.previous };

  const diagnoses: Diagnosis[] = [];
  const signals: Signal[] = [];

  // Evidence floor on BOTH windows + cross-period currency (same guards as comparePeriods).
  const evCur = evaluateEvidence({ tier: cur.worstTier, source: 'aggregate', complete: cur.complete, currency: cur.currency, sampleSize: cur.sampleSize, dateRange: input.period.current }, { ratioBased: true, ...o.staleness });
  const evPrev = evaluateEvidence({ tier: prev.worstTier, source: 'aggregate', complete: prev.complete, currency: prev.currency, sampleSize: prev.sampleSize, dateRange: input.period.previous }, { ratioBased: true, ...o.staleness });
  const currencyMismatch = !!(cur.currency && prev.currency && cur.currency !== prev.currency);
  const ratioActionable = evCur.actionable && evPrev.actionable && !cur.mixedCurrency && !prev.mixedCurrency && !currencyMismatch;

  // --- Data-quality signals that do NOT depend on ratio confidence (absolute facts). ---
  // High spend, zero conversions: a tracking/delivery red flag regardless of sample.
  if (c.spend > 0 && c.conversions === 0) {
    diagnoses.push(mk('DATA_QUALITY_ISSUE', input.scope, 'CRITICAL', tier, 'LOW',
      { en: `Spend recorded with zero conversions this period — tracking or delivery must be checked before any efficiency read.`, ar: `إنفاق مسجّل بدون أي تحويلات في هذه الفترة — يجب فحص التتبّع أو التسليم قبل أي قراءة للكفاءة.` },
      [ref('metric_delta', input.scope, 'conversions', periods, { spend: round(c.spend), conversions: 0 }, tier, 'conversions === 0 while spend > 0', ccy, attr)]));
  }

  if (currencyMismatch || cur.mixedCurrency || prev.mixedCurrency) {
    diagnoses.push(mk('DATA_QUALITY_ISSUE', input.scope, 'WATCH', tier, 'LOW',
      { en: `Currencies differ across the compared data; monetary deltas are not comparable without FX.`, ar: `العملات مختلفة بين البيانات المقارنة؛ لا يمكن مقارنة الفروق المالية دون سعر صرف.` },
      [ref('trust_gate', input.scope, undefined, periods, { currentCurrency: cur.currency ?? 'mixed', previousCurrency: prev.currency ?? 'mixed' }, tier, 'cur.currency !== prev.currency or mixed within a window', ccy)]));
  }

  // --- Spend / delivery (absolute, currency-aware; same-currency required for a monetary delta). ---
  if (!currencyMismatch) {
    const spendP = pct(p.spend, c.spend);
    const spendDir = dirOf(p.spend, c.spend, o.volumeMaterialPct);
    if (spendDir !== 'flat') {
      const type: DiagnosisType = spendDir === 'up' ? 'SPEND_INCREASE' : 'SPEND_DECREASE';
      const sig = signal('spend', input.scope, p.spend, c.spend, spendDir, true, ref('metric_delta', input.scope, 'spend', periods, { from: round(p.spend), to: round(c.spend), pct: roundN(spendP) }, tier, 'spend delta', ccy, attr));
      signals.push(sig);
      diagnoses.push(mk(type, input.scope, 'INFO', tier, deriveConfidence({ dataTrust: tier, windowComplete: cur.complete, fresh: evCur.actionable || !o.staleness, signalStrengthPct: spendP }),
        spendDir === 'up' ? { en: `Spend rose ${fmtPct(spendP)} period-over-period.`, ar: `ارتفع الإنفاق بنسبة ${fmtPct(spendP)} مقارنة بالفترة السابقة.` } : { en: `Spend fell ${fmtPct(spendP)} period-over-period.`, ar: `انخفض الإنفاق بنسبة ${fmtPct(spendP)} مقارنة بالفترة السابقة.` },
        [sig.evidence]));
    }
  }

  // Pacing (Phase 2E uses budgetPacing; see pacing.ts for the richer engine — here we flag over/under).
  if (input.pacing && input.pacing.plannedBudget > 0 && input.pacing.daysInPeriod > 0 && !cur.mixedCurrency) {
    const expected = Math.min(1, input.pacing.daysElapsed / input.pacing.daysInPeriod);
    const actual = c.spend / input.pacing.plannedBudget;
    const drift = actual - expected;
    if (Math.abs(drift) >= 0.1) {
      const over = drift > 0;
      diagnoses.push(mk(over ? 'OVERSPEND_VS_PACING' : 'UNDERDELIVERY', input.scope, over ? 'ATTENTION' : 'WATCH', tier,
        deriveConfidence({ dataTrust: tier, windowComplete: cur.complete, signalStrengthPct: drift * 100 }),
        over ? { en: `Spending ahead of plan: ${fmtFrac(actual)} of budget used at ${fmtFrac(expected)} of the period.`, ar: `الإنفاق أسرع من الخطة: استُخدم ${fmtFrac(actual)} من الميزانية عند ${fmtFrac(expected)} من الفترة.` } : { en: `Underdelivering: ${fmtFrac(actual)} of budget used at ${fmtFrac(expected)} of the period.`, ar: `تسليم أقل من المتوقع: استُخدم ${fmtFrac(actual)} من الميزانية عند ${fmtFrac(expected)} من الفترة.` },
        [ref('pacing', input.scope, 'spend', periods, { expectedFraction: roundN(expected * 100), actualFraction: roundN(actual * 100), plannedBudget: round(input.pacing.plannedBudget) }, tier, 'actual spend fraction vs straight-line expected fraction', ccy)]));
    }
  }

  // --- Conversion volume + rate. ---
  const convDir = dirOf(p.conversions, c.conversions, o.volumeMaterialPct);
  if (convDir !== 'flat') {
    const type: DiagnosisType = convDir === 'down' ? 'CONVERSION_VOLUME_DECLINE' : 'CONVERSION_VOLUME_INCREASE';
    const cp = pct(p.conversions, c.conversions);
    const sig = signal('conversions', input.scope, p.conversions, c.conversions, convDir, true, ref('metric_delta', input.scope, 'conversions', periods, { from: round(p.conversions), to: round(c.conversions), pct: roundN(cp) }, tier, 'conversions delta', ccy, attr));
    signals.push(sig);
    diagnoses.push(mk(type, input.scope, convDir === 'down' ? 'ATTENTION' : 'INFO', tier,
      deriveConfidence({ dataTrust: tier, windowComplete: cur.complete, fresh: evCur.actionable || !o.staleness, signalStrengthPct: cp, attributionConsistent }),
      convDir === 'down' ? { en: `Conversions fell ${fmtPct(cp)}.`, ar: `انخفضت التحويلات بنسبة ${fmtPct(cp)}.` } : { en: `Conversions rose ${fmtPct(cp)}.`, ar: `ارتفعت التحويلات بنسبة ${fmtPct(cp)}.` },
      [sig.evidence]));
  }
  // Conversion-rate decline (ratio — needs evidence).
  if (ratioActionable) {
    const cvrDir = dirOf(p.cvr, c.cvr, o.materialPct);
    if (cvrDir === 'down') {
      const cvp = pct(p.cvr, c.cvr);
      diagnoses.push(mk('CONVERSION_RATE_DECLINE', input.scope, 'ATTENTION', tier,
        deriveConfidence({ dataTrust: tier, ratioBased: true, sampleSize: cur.sampleSize, windowComplete: cur.complete, signalStrengthPct: cvp, attributionConsistent }),
        { en: `Conversion rate (conv/clicks) fell ${fmtPct(cvp)} — the drop is in landing/conversion, not traffic volume.`, ar: `انخفض معدل التحويل (تحويلات/نقرات) بنسبة ${fmtPct(cvp)} — الانخفاض في مرحلة الوصول/التحويل وليس في حجم الزيارات.` },
        [ref('ratio', input.scope, 'conversions', periods, { from: roundN(p.cvr), to: roundN(c.cvr), pct: roundN(cvp) }, tier, 'CVR = conversions/clicks*100', ccy, attr)]));
    }
  }

  // --- CPA with factor decomposition (CPA = CPM / CTR / CVR, in logs). ---
  if (ratioActionable && c.cpa > 0 && p.cpa > 0) {
    const cpaDir = dirOf(p.cpa, c.cpa, o.materialPct);
    if (cpaDir !== 'flat') {
      const cpaP = pct(p.cpa, c.cpa);
      const factors = decompose([
        { factor: 'media_cost', metric: 'cpm', dln: dln(p.cpm, c.cpm) },
        { factor: 'click_through', metric: 'ctr', dln: dln(c.ctr, p.ctr) === undefined ? undefined : -dln(p.ctr, c.ctr)! }, // CTR enters CPA inversely
        { factor: 'conversion_rate', metric: 'conversions', dln: dln(p.cvr, c.cvr) === undefined ? undefined : -dln(p.cvr, c.cvr)! },
      ]);
      const worse = cpaDir === 'up';
      diagnoses.push(mk(worse ? 'CPA_DETERIORATION' : 'CPA_IMPROVEMENT', input.scope, worse ? 'ATTENTION' : 'INFO', tier,
        deriveConfidence({ dataTrust: tier, ratioBased: true, sampleSize: cur.sampleSize, windowComplete: cur.complete, fresh: evCur.actionable || !o.staleness, signalStrengthPct: cpaP, attributionConsistent }),
        worse ? { en: `CPA rose ${fmtPct(cpaP)}${factorText(factors, 'en')}`, ar: `ارتفعت تكلفة الاكتساب بنسبة ${fmtPct(cpaP)}${factorText(factors, 'ar')}` } : { en: `CPA improved ${fmtPct(cpaP)}${factorText(factors, 'en')}`, ar: `تحسّنت تكلفة الاكتساب بنسبة ${fmtPct(cpaP)}${factorText(factors, 'ar')}` },
        [ref('ratio', input.scope, 'cpa', periods, { from: round(p.cpa), to: round(c.cpa), pct: roundN(cpaP) }, tier, 'CPA = spend/conversions; decomposed as ln CPA = ln CPM − ln CTR − ln CVR', ccy, attr)],
        factors?.map((f) => ({ factor: f.factor, metric: f.metric, sharePct: f.sharePct })) ));
    }
  }

  // --- ROAS with driver attribution (ROAS = conversions * AOV / spend, in logs). ---
  if (ratioActionable && c.roas > 0 && p.roas > 0) {
    const roasDir = dirOf(p.roas, c.roas, o.materialPct);
    if (roasDir !== 'flat') {
      const roasP = pct(p.roas, c.roas);
      const factors = decompose([
        { factor: 'conversion_volume', metric: 'conversions', dln: dln(p.conversions, c.conversions) },
        { factor: 'conversion_value_per_conv', metric: 'conversion_value', dln: dln(p.aov, c.aov) },
        { factor: 'spend', metric: 'spend', dln: dln(p.spend, c.spend) === undefined ? undefined : -dln(p.spend, c.spend)! }, // spend enters inversely
      ]);
      const worse = roasDir === 'down';
      diagnoses.push(mk(worse ? 'ROAS_DETERIORATION' : 'ROAS_IMPROVEMENT', input.scope, worse ? 'ATTENTION' : 'INFO', tier,
        deriveConfidence({ dataTrust: tier, ratioBased: true, sampleSize: cur.sampleSize, windowComplete: cur.complete, fresh: evCur.actionable || !o.staleness, signalStrengthPct: roasP, attributionConsistent }),
        worse ? { en: `ROAS fell ${fmtPct(roasP)}${factorText(factors, 'en')}`, ar: `انخفض العائد على الإنفاق الإعلاني بنسبة ${fmtPct(roasP)}${factorText(factors, 'ar')}` } : { en: `ROAS rose ${fmtPct(roasP)}${factorText(factors, 'en')}`, ar: `ارتفع العائد على الإنفاق الإعلاني بنسبة ${fmtPct(roasP)}${factorText(factors, 'ar')}` },
        [ref('ratio', input.scope, 'roas', periods, { from: roundN(p.roas), to: roundN(c.roas), pct: roundN(roasP) }, tier, 'ROAS = value/spend; decomposed as ln ROAS = ln conversions + ln AOV − ln spend', ccy, attr)],
        factors?.map((f) => ({ factor: f.factor, metric: f.metric, sharePct: f.sharePct })) ));
    }
  }

  // --- CTR / CPM / CPC. ---
  if (ratioActionable) {
    const ctrDir = dirOf(p.ctr, c.ctr, o.materialPct);
    if (ctrDir !== 'flat') {
      const ctrP = pct(p.ctr, c.ctr);
      diagnoses.push(mk(ctrDir === 'down' ? 'CTR_DETERIORATION' : 'CTR_IMPROVEMENT', input.scope, ctrDir === 'down' ? 'WATCH' : 'INFO', tier,
        deriveConfidence({ dataTrust: tier, ratioBased: true, sampleSize: Math.round(c.clicks), windowComplete: cur.complete, signalStrengthPct: ctrP }),
        ctrDir === 'down' ? { en: `CTR fell ${fmtPct(ctrP)} — engagement with the creative/placement weakened.`, ar: `انخفض معدل النقر بنسبة ${fmtPct(ctrP)} — ضعف التفاعل مع الإعلان/الموضع.` } : { en: `CTR rose ${fmtPct(ctrP)}.`, ar: `ارتفع معدل النقر بنسبة ${fmtPct(ctrP)}.` },
        [ref('ratio', input.scope, 'ctr', periods, { from: roundN(p.ctr), to: roundN(c.ctr), pct: roundN(ctrP) }, tier, 'CTR = clicks/impressions*100', ccy)]));
    }
    const cpmDir = dirOf(p.cpm, c.cpm, o.materialPct);
    if (cpmDir === 'up' && !currencyMismatch) {
      const cpmP = pct(p.cpm, c.cpm);
      diagnoses.push(mk('CPM_PRESSURE', input.scope, 'WATCH', tier,
        deriveConfidence({ dataTrust: tier, windowComplete: cur.complete, signalStrengthPct: cpmP }),
        { en: `CPM rose ${fmtPct(cpmP)} — media auction cost pressure.`, ar: `ارتفعت تكلفة الألف ظهور بنسبة ${fmtPct(cpmP)} — ضغط في تكلفة مزاد الوسائط.` },
        [ref('ratio', input.scope, 'cpm', periods, { from: round(p.cpm), to: round(c.cpm), pct: roundN(cpmP) }, tier, 'CPM = spend/impressions*1000', ccy)]));
    }
    const cpcDir = dirOf(p.cpc, c.cpc, o.materialPct);
    if (cpcDir === 'up' && !currencyMismatch) {
      const cpcP = pct(p.cpc, c.cpc);
      const cpcFactors = decompose([
        { factor: 'media_cost', metric: 'cpm', dln: dln(p.cpm, c.cpm) },
        { factor: 'click_through', metric: 'ctr', dln: dln(p.ctr, c.ctr) === undefined ? undefined : -dln(p.ctr, c.ctr)! },
      ]);
      diagnoses.push(mk('CPC_PRESSURE', input.scope, 'WATCH', tier,
        deriveConfidence({ dataTrust: tier, windowComplete: cur.complete, signalStrengthPct: cpcP }),
        { en: `CPC rose ${fmtPct(cpcP)}${factorText(cpcFactors, 'en')}`, ar: `ارتفعت تكلفة النقرة بنسبة ${fmtPct(cpcP)}${factorText(cpcFactors, 'ar')}` },
        [ref('ratio', input.scope, 'cpc', periods, { from: round(p.cpc), to: round(c.cpc), pct: roundN(cpcP) }, tier, 'CPC = spend/clicks; decomposed as ln CPC = ln CPM − ln CTR (separates media cost from engagement)', ccy)],
        cpcFactors?.map((f) => ({ factor: f.factor, metric: f.metric, sharePct: f.sharePct })) ));
    }
  }

  // --- Frequency: only when a business/provider ceiling is supplied (no universal threshold). ---
  if (o.frequencyCeiling != null && typeof c.frequency === 'number' && c.frequency > o.frequencyCeiling) {
    diagnoses.push(mk('FREQUENCY_PRESSURE', input.scope, 'WATCH', tier,
      deriveConfidence({ dataTrust: tier, windowComplete: cur.complete }),
      { en: `Frequency ${roundN(c.frequency)} exceeds the configured ceiling ${o.frequencyCeiling} — possible audience over-exposure.`, ar: `بلغ التكرار ${roundN(c.frequency)} متجاوزًا الحد المُهيّأ ${o.frequencyCeiling} — احتمال إفراط في تعريض الجمهور.` },
      [ref('ratio', input.scope, 'frequency', periods, { frequency: roundN(c.frequency), ceiling: o.frequencyCeiling }, tier, 'frequency > configured ceiling (not a universal threshold)', ccy)]));
  }

  // If ratio diagnoses were suppressed by the evidence floor, say so explicitly (don't stay silent).
  if (!ratioActionable) {
    const reasons = [...evCur.reasons, ...evPrev.reasons.map((r) => `previous window: ${r}`)];
    if (currencyMismatch) reasons.push('current and previous windows use different currencies');
    diagnoses.push(mk('INSUFFICIENT_EVIDENCE', input.scope, 'INFO', tier, 'LOW',
      { en: `Not enough trustworthy evidence for a confident efficiency (CPA/ROAS/rate) read: ${reasons.join('; ')}.`, ar: `لا توجد أدلة كافية وموثوقة لقراءة واثقة للكفاءة (تكلفة الاكتساب/العائد/المعدل): ${reasons.join('؛ ')}.` },
      [ref('trust_gate', input.scope, undefined, periods, { reasons: reasons.join('; ') }, tier, 'evaluateEvidence(current) && evaluateEvidence(previous) not actionable', ccy)]));
  }

  return { diagnoses: prioritize(diagnoses), signals };
}

function signal(metric: CanonicalMetric, scope: DiagnoseScope, from: number, to: number, direction: 'up' | 'down', material: boolean, evidence: EvidenceRef): Signal {
  return { metric, entityId: scope.entityId, entityLevel: scope.entityLevel, direction, from, to, pct: pct(from, to), material, evidence };
}

function mk(type: DiagnosisType, scope: DiagnoseScope, severity: Severity, dataTrust: DataTier, confidence: Diagnosis['confidence'], summary: BiText, evidence: EvidenceRef[], factors?: Diagnosis['factors']): Diagnosis {
  return { type, scope: { organizationId: scope.organizationId, accountId: scope.accountId, entityId: scope.entityId, entityLevel: scope.entityLevel }, severity, summary, evidence, confidence, dataTrust, factors };
}

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, ATTENTION: 2, WATCH: 1, INFO: 0 };
function prioritize(ds: Diagnosis[]): Diagnosis[] {
  return [...ds].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function factorText(factors: FactorShare[] | undefined, lang: 'en' | 'ar'): string {
  if (!factors || factors.length === 0) return lang === 'en' ? '.' : '.';
  const top = [...factors].sort((a, b) => b.sharePct - a.sharePct)[0]!;
  const label = FACTOR_LABELS[top.factor]?.[lang] ?? top.factor;
  return lang === 'en' ? `, driven mostly by ${label} (${top.sharePct}% of the move).` : `، مدفوعًا أساسًا بـ${label} (${top.sharePct}% من الحركة).`;
}
const FACTOR_LABELS: Record<string, BiText> = {
  media_cost: { en: 'media cost (CPM)', ar: 'تكلفة الوسائط (CPM)' },
  click_through: { en: 'click-through rate', ar: 'معدل النقر' },
  conversion_rate: { en: 'conversion rate', ar: 'معدل التحويل' },
  conversion_volume: { en: 'conversion volume', ar: 'حجم التحويلات' },
  conversion_value_per_conv: { en: 'value per conversion', ar: 'القيمة لكل تحويل' },
  spend: { en: 'spend level', ar: 'مستوى الإنفاق' },
};

function round(n: number): number { return Math.round(n * 100) / 100; }
function roundN(n: number | undefined): number | null { return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100; }
function fmtPct(n: number | undefined): string { return n == null ? '—' : `${Math.abs(Math.round(n * 10) / 10)}%`; }
function fmtFrac(n: number): string { return `${Math.round(n * 100)}%`; }
