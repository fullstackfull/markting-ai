/**
 * Coherence Program 1.2 — the canonical INTELLIGENCE RESULT envelope.
 *
 * Every orchestrated analysis returns this one envelope, carrying (as available) the composed
 * diagnosis, ranked contributing factors, a single recommended next action, unified recommendations,
 * the evidence behind every claim, the trust/uncertainty, and the next best question. Absent domains
 * are represented explicitly (a `DomainAvailability` entry), never silently omitted or faked.
 */
import type { BiText, EvidenceRef, Severity } from '../intelligence/decision-model';
import type { DataTier } from '../data-trust';
import type { UnifiedRecommendation } from './recommendation';
import type { TrustSummary } from './trust';
import type { IntelligenceIntent, IntelligenceRequestContext } from './context';

/** The single recommended posture for the user — never an automatic action. */
export const NEXT_ACTIONS = [
  'ATTENTION', 'INVESTIGATE', 'REVIEW', 'EXPERIMENT', 'MONITOR', 'NO_ACTION', 'INSUFFICIENT_EVIDENCE',
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const INTELLIGENCE_DOMAINS = ['MEDIA', 'COMMERCE', 'CREATIVE', 'HISTORY', 'MEMORY', 'EXPERIMENTS'] as const;
export type IntelligenceDomain = (typeof INTELLIGENCE_DOMAINS)[number];

/** Whether a domain contributed, and if not, why (so the UI can show an honest empty/blocked state). */
export interface DomainAvailability {
  domain: IntelligenceDomain;
  state: 'CONTRIBUTED' | 'NO_SIGNAL' | 'NOT_CONNECTED' | 'INSUFFICIENT_EVIDENCE' | 'BLOCKED_EXTERNAL';
  note?: BiText;
}

/**
 * One ranked contributing factor in a cross-domain diagnosis (e.g. "refunds eroded net revenue"),
 * with the deterministic priority score and the evidence that supports it. The LLM may narrate these
 * but never reorders them or invents a factor not present here.
 */
export interface ContributingFactor {
  domain: IntelligenceDomain;
  key: string;
  summary: BiText;
  severity: Severity;
  /** Deterministic priority score (higher = more important); see scoreFactor in orchestrator.ts. */
  priority: number;
  /** Financial materiality 0..1 where known (share of the decline/impact this factor explains). */
  materiality?: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  dataTrust: DataTier;
  evidence: EvidenceRef[];
  /** Native evidence detail from the contributing engine, preserved for drill-down. */
  evidenceDetail?: Record<string, unknown>;
}

/** The composed, cross-domain diagnosis — one coherent story, not a bag of disconnected findings. */
export interface ComposedDiagnosis {
  /** A single structured headline derived deterministically from the top factors (bilingual). */
  headline: BiText;
  severity: Severity;
  factors: ContributingFactor[];
  /** Unresolved questions / data gaps that limit certainty (never fabricated confidence). */
  unresolved: BiText[];
}

export interface IntelligenceResult {
  intent: IntelligenceIntent;
  context: Pick<IntelligenceRequestContext, 'organizationId' | 'accountId' | 'provider' | 'period' | 'comparisonPeriod' | 'reportingCurrency' | 'runtimeMode'>;
  diagnosis: ComposedDiagnosis;
  nextAction: NextAction;
  /** The single next best question/action to deepen the analysis (bilingual). */
  nextBestQuestion?: BiText;
  recommendations: UnifiedRecommendation[];
  trust: TrustSummary;
  domains: DomainAvailability[];
  /** When the answer was narrated by a model vs deterministic composition (set by the assistant layer). */
  answerSource?: 'LIVE_MODEL' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_ONLY';
  generatedAt: string;
}
