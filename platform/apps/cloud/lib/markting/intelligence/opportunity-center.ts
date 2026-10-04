/**
 * Phase 2T — the Opportunity Center. It organizes the account intelligence into the five product
 * surfaces (Needs Attention / Opportunities / Monitoring / Data Issues / Recommendations) and
 * prioritizes by MATERIALITY, so the user is not drowned in every statistical wiggle. Materiality
 * combines diagnosis severity, the entity's spend share, and recommendation risk/confidence.
 */
import type { AccountIntelligence } from './analyze';
import type { BiText, Diagnosis, Recommendation, Severity } from './decision-model';

/**
 * B25 — attention-queue transparency. A ranked item does not carry an opaque score: it carries the
 * DETERMINISTIC factor contributions that produced its materiality, so the UI can show WHY it ranks
 * where it does (severity, spend magnitude, and the confidence/data-trust discounts). No model, no
 * hidden AI score — the factors reconstruct the number.
 */
export interface MaterialityFactor { key: 'severity' | 'spend_share' | 'confidence' | 'data_trust'; label: BiText; contribution: number }
export interface AttentionItem { entityId: string; name: string; severity: Severity; headline: BiText; spendShare: number; materiality: number; factors: MaterialityFactor[] }
export interface OpportunityItem { entityId: string; name: string; headline: BiText; spendShare: number }
export interface DataIssueItem { entityId: string; name: string; headline: BiText }

export interface OpportunityCenter {
  needsAttention: AttentionItem[];
  opportunities: OpportunityItem[];
  monitoring: Array<{ entityId: string; name: string; headline: BiText }>;
  dataIssues: DataIssueItem[];
  recommendations: Recommendation[];
}

const SEV_WEIGHT: Record<Severity, number> = { CRITICAL: 100, ATTENTION: 60, WATCH: 25, INFO: 5 };
const CONF_MULT: Record<string, number> = { HIGH: 1, MEDIUM: 0.75, LOW: 0.5 };
const TRUST_MULT: Record<string, number> = { RECONCILED: 1, VALIDATED: 1, PLATFORM_REPORTED: 0.9, UNVERIFIED: 0.6, SYNTHETIC: 0.3 };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Transparent materiality: the SAME deterministic formula as before (severity dominates; spend share
 * lifts big-money items; confidence + trust DISCOUNT shaky evidence so a LOW-confidence / SYNTHETIC
 * ATTENTION item does not outrank a HIGH-confidence, trustworthy one), decomposed into the named factor
 * contributions that reconstruct the total. `total` is unchanged from the prior scalar score so ordering
 * is identical; `factors` make the reasoning inspectable instead of opaque.
 */
export function materialityBreakdown(severity: Severity, spendShare: number, confidence?: string, dataTrust?: string): { total: number; factors: MaterialityFactor[] } {
  const confMult = CONF_MULT[confidence ?? 'MEDIUM'] ?? 0.75;
  const trustMult = TRUST_MULT[dataTrust ?? 'PLATFORM_REPORTED'] ?? 0.9;
  const mult = confMult * trustMult;
  const sevBase = SEV_WEIGHT[severity];
  const shareBase = Math.min(40, spendShare * 0.4);
  const total = (sevBase + shareBase) * mult;
  // The two positive drivers sum to the total; the discounts are reported as the points they removed.
  const sevContribution = round1(sevBase * mult);
  const shareContribution = round1(shareBase * mult);
  const factors: MaterialityFactor[] = [
    { key: 'severity', label: { en: `Severity ${severity}`, ar: `الخطورة ${severity}` }, contribution: sevContribution },
    { key: 'spend_share', label: { en: `Spend share ${Math.round(spendShare)}%`, ar: `حصة الإنفاق ${Math.round(spendShare)}%` }, contribution: shareContribution },
  ];
  if (confMult < 1) factors.push({ key: 'confidence', label: { en: `Confidence ${confidence ?? 'MEDIUM'} discount ×${confMult}`, ar: `خصم الثقة ${confidence ?? 'MEDIUM'} ×${confMult}` }, contribution: round1((sevBase + shareBase) * trustMult * (confMult - 1)) });
  if (trustMult < 1) factors.push({ key: 'data_trust', label: { en: `Data trust ${dataTrust ?? 'PLATFORM_REPORTED'} discount ×${trustMult}`, ar: `خصم موثوقية البيانات ${dataTrust ?? 'PLATFORM_REPORTED'} ×${trustMult}` }, contribution: round1((sevBase + shareBase) * confMult * (trustMult - 1)) });
  return { total, factors };
}

export function buildOpportunityCenter(intel: AccountIntelligence): OpportunityCenter {
  const needsAttention: AttentionItem[] = [];
  const opportunities: OpportunityItem[] = [];
  const monitoring: OpportunityCenter['monitoring'] = [];
  const dataIssues: DataIssueItem[] = [];

  const spendShareOf = new Map(intel.campaigns.map((c) => [c.entityId, c.spendShare]));

  const consider = (d: Diagnosis, name: string) => {
    const share = spendShareOf.get(d.scope.entityId) ?? (d.scope.entityLevel === 'account' ? 100 : 0);
    if (d.type === 'DATA_QUALITY_ISSUE' || d.type === 'INSUFFICIENT_EVIDENCE') {
      dataIssues.push({ entityId: d.scope.entityId, name, headline: d.summary });
      return;
    }
    if (d.type.endsWith('_IMPROVEMENT') || d.type === 'CONVERSION_VOLUME_INCREASE' || d.type === 'TARGET_BEAT') {
      opportunities.push({ entityId: d.scope.entityId, name, headline: d.summary, spendShare: share });
      return;
    }
    if (d.severity === 'ATTENTION' || d.severity === 'CRITICAL') {
      const mat = materialityBreakdown(d.severity, share, d.confidence, d.dataTrust);
      needsAttention.push({ entityId: d.scope.entityId, name, severity: d.severity, headline: d.summary, spendShare: share, materiality: mat.total, factors: mat.factors });
    } else {
      monitoring.push({ entityId: d.scope.entityId, name, headline: d.summary });
    }
  };

  for (const d of intel.accountDiagnoses) consider(d, 'Account');
  for (const c of intel.campaigns) for (const d of c.diagnoses) consider(d, c.name);

  // Deterministic order: materiality desc, with a stable tie-break on entityId (never arbitrary).
  needsAttention.sort((a, b) => b.materiality - a.materiality || a.entityId.localeCompare(b.entityId));
  opportunities.sort((a, b) => b.spendShare - a.spendShare || a.entityId.localeCompare(b.entityId));

  // Recommendations surfaced for review, most material first (REVIEWABLE before DRAFT; higher risk/share first).
  const recRank = (r: Recommendation) => (r.status === 'REVIEWABLE' ? 2 : r.status === 'DRAFT' ? 1 : 0) * 1000 + ({ CRITICAL: 400, HIGH: 300, MODERATE: 200, LOW: 100 }[r.risk]) + (spendShareOf.get(r.entityScope.entityId) ?? 0);
  const recommendations = [...intel.recommendations].filter((r) => r.status === 'REVIEWABLE' || r.status === 'DRAFT').sort((a, b) => recRank(b) - recRank(a));

  return { needsAttention, opportunities, monitoring, dataIssues, recommendations };
}
