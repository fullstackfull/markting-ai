/**
 * Coherence Programs 1 + 2 — the MarketingIntelligenceOrchestrator.
 *
 * This is the "missing middle" the reassessment identified: ONE application-level composition service
 * that invokes the existing deterministic engines coherently and returns ONE `IntelligenceResult`.
 * It does not merge the engines physically; it composes their structured outputs. The composition is
 * fully deterministic — the LLM (later, in the assistant layer) narrates this result, it never
 * computes or reorders it.
 *
 * The cross-domain question the reassessment proved unanswerable — "Why did profitability decline and
 * what should I do?" — is answerable here: media diagnostics + commerce truth + creative health +
 * history compose into one ranked diagnosis, one next action, and unified recommendations. Absent
 * domains (e.g. no connected store, no live data) are represented explicitly, never faked.
 */
import type { Diagnosis, Recommendation, Severity, BiText } from '../intelligence/decision-model';
import type { CommerceDiagnosis, CommerceRecommendation } from '../commerce/diagnostics';
import type { CreativeRecommendation } from '../creative/recommendations';
import type { OptimizationRecommendation } from '../optimize/recommendations';
import type { IntelligenceIntent, IntelligenceRequestContext } from './context';
import {
  type ComposedDiagnosis, type ContributingFactor, type DomainAvailability, type IntelligenceDomain,
  type IntelligenceResult, type NextAction,
} from './envelope';
import {
  type UnifiedRecommendation, fromMediaRecommendation, fromCreativeRecommendation,
  fromCommerceRecommendation, fromOptimizationRecommendation, rankRecommendations,
} from './recommendation';
import { type DataTier, summarizeTrust } from './trust';

export interface OrchestratorInput {
  context: IntelligenceRequestContext;
  intent: IntelligenceIntent;
  media?: { diagnoses?: Diagnosis[]; recommendations?: Recommendation[] };
  commerce?: { diagnoses?: CommerceDiagnosis[]; recommendations?: CommerceRecommendation[] };
  creative?: { recommendations?: CreativeRecommendation[] };
  optimize?: { recommendations?: OptimizationRecommendation[] };
  history?: { note?: BiText; priorOutcomeSummary?: BiText };
  memory?: { note?: BiText };
  /** Optional deterministic financial attribution: share (0..1) of the decline each factor key explains. */
  materiality?: Record<string, number>;
  /** Explicit availability for domains that could not run (no store connected, blocked external, etc.). */
  availability?: Partial<Record<IntelligenceDomain, DomainAvailability['state']>>;
}

const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, WATCH: 1, ATTENTION: 2, CRITICAL: 3 };
const CONFIDENCE_WEIGHT: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Commerce's 3-level severity → the canonical 4-level severity. MATERIAL is treated as ATTENTION. */
function commerceSeverity(s: CommerceDiagnosis['severity']): Severity {
  return s === 'MATERIAL' ? 'ATTENTION' : s === 'WATCH' ? 'WATCH' : 'INFO';
}

/**
 * Deterministic factor priority. Severity dominates; financial materiality and diagnosis confidence
 * break ties. Never model-derived. Keeping it a pure number lets the UI and tests assert ordering.
 */
export function scoreFactor(f: Pick<ContributingFactor, 'severity' | 'materiality' | 'confidence'>): number {
  return SEVERITY_RANK[f.severity] * 100 + Math.round((f.materiality ?? 0) * 50) + CONFIDENCE_WEIGHT[f.confidence] * 5;
}

function mediaFactors(diagnoses: Diagnosis[] = [], materiality: Record<string, number>): ContributingFactor[] {
  return diagnoses
    .filter((d) => d.type !== 'INSUFFICIENT_EVIDENCE')
    .map((d) => {
      const key = `MEDIA:${d.type}`;
      const f: ContributingFactor = {
        domain: 'MEDIA', key, summary: d.summary, severity: d.severity,
        confidence: d.confidence, dataTrust: d.dataTrust, evidence: d.evidence,
        evidenceDetail: d.factors ? { factors: d.factors } : undefined,
        materiality: materiality[key], priority: 0,
      };
      f.priority = scoreFactor(f);
      return f;
    });
}

function commerceFactors(diagnoses: CommerceDiagnosis[] = [], trust: DataTier, materiality: Record<string, number>): ContributingFactor[] {
  return diagnoses.map((d) => {
    const key = `COMMERCE:${d.type}`;
    const severity = commerceSeverity(d.severity);
    const f: ContributingFactor = {
      domain: 'COMMERCE', key, summary: d.summary, severity,
      confidence: 'MEDIUM', dataTrust: trust, evidence: [], evidenceDetail: d.evidence,
      materiality: materiality[key], priority: 0,
    };
    f.priority = scoreFactor(f);
    return f;
  });
}

function creativeFactors(recs: CreativeRecommendation[] = [], materiality: Record<string, number>): ContributingFactor[] {
  // Only creative signals that indicate a problem become diagnosis factors (fatigue/underperformer/
  // concentration). Pure test ideas are opportunities, surfaced as recommendations, not factors.
  const problem = new Set(['CREATIVE_FATIGUE_REVIEW', 'UNDERPERFORMER_REVIEW', 'CREATIVE_CONCENTRATION_REVIEW']);
  return recs.filter((r) => problem.has(r.category)).map((r) => {
    const key = `CREATIVE:${r.category}`;
    const severity: Severity = r.risk === 'HIGH' ? 'ATTENTION' : 'WATCH';
    const f: ContributingFactor = {
      domain: 'CREATIVE', key, summary: r.reasoning, severity,
      confidence: r.confidence, dataTrust: r.dataTrust, evidence: [], evidenceDetail: r.evidence,
      materiality: materiality[key], priority: 0,
    };
    f.priority = scoreFactor(f);
    return f;
  });
}

/** Build the single bilingual headline deterministically from the ranked factors. */
function composeHeadline(intent: IntelligenceIntent, factors: ContributingFactor[]): BiText {
  if (factors.length === 0) {
    return { en: 'No material issues detected from the available evidence.', ar: 'لا توجد مشكلات جوهرية من الأدلة المتاحة.' };
  }
  const top = factors[0]!;
  if (intent === 'PROFITABILITY_DECLINE') {
    const commerce = factors.find((f) => f.domain === 'COMMERCE');
    const media = factors.find((f) => f.domain === 'MEDIA');
    const creative = factors.find((f) => f.domain === 'CREATIVE');
    const parts: string[] = [];
    const partsAr: string[] = [];
    if (commerce) { parts.push('merchant-side signals (e.g. refunds/margin) drove the profit change'); partsAr.push('إشارات من جهة المتجر (مثل الاستردادات/الهامش) دفعت تغيّر الربح'); }
    if (media) { parts.push('ad-side efficiency (spend vs return) contributed'); partsAr.push('كفاءة الإعلانات (الإنفاق مقابل العائد) ساهمت'); }
    if (creative) { parts.push('a creative health signal is present on the largest-spend creative'); partsAr.push('توجد إشارة صحة إبداعية على الإعلان الأعلى إنفاقًا'); }
    if (parts.length) {
      return {
        en: `Profitability moved primarily because ${parts.join('; ')}. The ranked factors below show the supporting evidence; act on the top factor first.`,
        ar: `تغيّرت الربحية أساسًا لأن ${partsAr.join('؛ ')}. تُظهر العوامل المرتبة أدناه الأدلة الداعمة؛ ابدأ بالعامل الأهم.`,
      };
    }
  }
  return top.summary;
}

/** Map the ranked diagnosis to the single recommended next action. */
function selectNextAction(factors: ContributingFactor[], hasAnySignal: boolean): NextAction {
  if (factors.length === 0) return hasAnySignal ? 'MONITOR' : 'INSUFFICIENT_EVIDENCE';
  const top = factors[0]!;
  if (top.key.includes('DATA_QUALITY') || top.key.includes('DATA_GAPS') || top.key.includes('RECONCILIATION')) return 'INVESTIGATE';
  if (top.severity === 'CRITICAL') return 'ATTENTION';
  if (top.severity === 'ATTENTION') return 'REVIEW';
  if (top.severity === 'WATCH') return 'MONITOR';
  return 'MONITOR';
}

function nextBestQuestion(factors: ContributingFactor[]): BiText | undefined {
  const top = factors[0];
  if (!top) return undefined;
  if (top.domain === 'COMMERCE') return { en: 'Which products or campaigns drive the refund/margin impact?', ar: 'ما المنتجات أو الحملات التي تقود أثر الاسترداد/الهامش؟' };
  if (top.domain === 'MEDIA') return { en: 'Which campaign explains the largest spend inefficiency?', ar: 'أي حملة تفسّر أكبر قدر من عدم كفاءة الإنفاق؟' };
  if (top.domain === 'CREATIVE') return { en: 'Should we design a refresh test for the fatiguing creative?', ar: 'هل نصمّم اختبار تجديد للإعلان المُجهد؟' };
  return undefined;
}

export class MarketingIntelligenceOrchestrator {
  /**
   * Compose one cross-domain intelligence result from the structured outputs of the existing engines.
   * Pure and deterministic over its input. Callers (Wave 3) supply each domain slice from the real
   * data sources where available; absent slices are reported as unavailable, never fabricated.
   */
  compose(input: OrchestratorInput): IntelligenceResult {
    const materiality = input.materiality ?? {};
    const commerceTrust: DataTier = (input.commerce?.recommendations?.[0]?.dataTrust as DataTier | undefined) ?? 'PLATFORM_REPORTED';

    const factors = [
      ...mediaFactors(input.media?.diagnoses, materiality),
      ...commerceFactors(input.commerce?.diagnoses, commerceTrust, materiality),
      ...creativeFactors(input.creative?.recommendations, materiality),
    ].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));

    // Unify recommendations from every domain into one list, ranked for the Recommendation Center.
    const recommendations: UnifiedRecommendation[] = rankRecommendations([
      ...(input.media?.recommendations ?? []).map((r) => fromMediaRecommendation(r)),
      ...(input.creative?.recommendations ?? []).map((r) => fromCreativeRecommendation(r)),
      ...(input.commerce?.recommendations ?? []).map((r) => fromCommerceRecommendation(r)),
      ...(input.optimize?.recommendations ?? []).map((r) => fromOptimizationRecommendation(r)),
    ]);

    const unresolved: BiText[] = [];
    const dataGap = input.commerce?.diagnoses?.find((d) => d.type === 'COMMERCE_DATA_GAPS');
    if (dataGap) unresolved.push(dataGap.summary);
    if (input.media?.diagnoses?.some((d) => d.type === 'INSUFFICIENT_EVIDENCE')) {
      unresolved.push({ en: 'Some media signals lack sufficient evidence to diagnose.', ar: 'بعض إشارات الإعلانات تفتقر إلى أدلة كافية للتشخيص.' });
    }

    const severity: Severity = factors.length ? factors[0]!.severity : 'INFO';
    const diagnosis: ComposedDiagnosis = {
      headline: composeHeadline(input.intent, factors),
      severity,
      factors,
      unresolved,
    };

    const hasAnySignal = Boolean(
      input.media?.diagnoses?.length || input.commerce?.diagnoses?.length ||
      input.creative?.recommendations?.length || input.optimize?.recommendations?.length,
    );

    const trust = summarizeTrust(
      factors.length ? factors.map((f) => ({ tier: f.dataTrust })) : [{ tier: 'UNVERIFIED' as DataTier }],
    );

    return {
      intent: input.intent,
      context: {
        organizationId: input.context.organizationId,
        accountId: input.context.accountId,
        provider: input.context.provider,
        period: input.context.period,
        comparisonPeriod: input.context.comparisonPeriod,
        reportingCurrency: input.context.reportingCurrency,
        runtimeMode: input.context.runtimeMode,
      },
      diagnosis,
      nextAction: selectNextAction(factors, hasAnySignal),
      nextBestQuestion: nextBestQuestion(factors),
      recommendations,
      trust,
      domains: this.availability(input),
      answerSource: 'DETERMINISTIC_ONLY',
      generatedAt: new Date().toISOString(),
    };
  }

  /** Report which domains contributed vs were unavailable (honest empty/blocked states). */
  private availability(input: OrchestratorInput): DomainAvailability[] {
    const explicit = input.availability ?? {};
    const out: DomainAvailability[] = [];
    const add = (domain: IntelligenceDomain, contributed: boolean) => {
      const state = explicit[domain] ?? (contributed ? 'CONTRIBUTED' : 'NO_SIGNAL');
      out.push({ domain, state });
    };
    add('MEDIA', Boolean(input.media?.diagnoses?.length || input.media?.recommendations?.length));
    add('COMMERCE', Boolean(input.commerce?.diagnoses?.length || input.commerce?.recommendations?.length));
    add('CREATIVE', Boolean(input.creative?.recommendations?.length));
    add('HISTORY', Boolean(input.history?.priorOutcomeSummary));
    add('MEMORY', Boolean(input.memory?.note));
    add('EXPERIMENTS', Boolean(input.optimize?.recommendations?.length));
    return out;
  }
}

/** Shared singleton — the orchestrator is stateless, so one instance is safe to reuse. */
export const orchestrator = new MarketingIntelligenceOrchestrator();
