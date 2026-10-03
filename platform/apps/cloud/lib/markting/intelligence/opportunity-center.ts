/**
 * Phase 2T — the Opportunity Center. It organizes the account intelligence into the five product
 * surfaces (Needs Attention / Opportunities / Monitoring / Data Issues / Recommendations) and
 * prioritizes by MATERIALITY, so the user is not drowned in every statistical wiggle. Materiality
 * combines diagnosis severity, the entity's spend share, and recommendation risk/confidence.
 */
import type { AccountIntelligence } from './analyze';
import type { BiText, Diagnosis, Recommendation, Severity } from './decision-model';

export interface AttentionItem { entityId: string; name: string; severity: Severity; headline: BiText; spendShare: number; materiality: number }
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

function materiality(severity: Severity, spendShare: number, confidence?: string, dataTrust?: string): number {
  // Severity dominates; spend share lifts big-money items; confidence + trust DISCOUNT shaky evidence
  // so a LOW-confidence / SYNTHETIC ATTENTION item does not outrank a HIGH-confidence, trustworthy one.
  const base = SEV_WEIGHT[severity] + Math.min(40, spendShare * 0.4);
  return base * (CONF_MULT[confidence ?? 'MEDIUM'] ?? 0.75) * (TRUST_MULT[dataTrust ?? 'PLATFORM_REPORTED'] ?? 0.9);
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
      needsAttention.push({ entityId: d.scope.entityId, name, severity: d.severity, headline: d.summary, spendShare: share, materiality: materiality(d.severity, share, d.confidence, d.dataTrust) });
    } else {
      monitoring.push({ entityId: d.scope.entityId, name, headline: d.summary });
    }
  };

  for (const d of intel.accountDiagnoses) consider(d, 'Account');
  for (const c of intel.campaigns) for (const d of c.diagnoses) consider(d, c.name);

  needsAttention.sort((a, b) => b.materiality - a.materiality);
  opportunities.sort((a, b) => b.spendShare - a.spendShare);

  // Recommendations surfaced for review, most material first (REVIEWABLE before DRAFT; higher risk/share first).
  const recRank = (r: Recommendation) => (r.status === 'REVIEWABLE' ? 2 : r.status === 'DRAFT' ? 1 : 0) * 1000 + ({ CRITICAL: 400, HIGH: 300, MODERATE: 200, LOW: 100 }[r.risk]) + (spendShareOf.get(r.entityScope.entityId) ?? 0);
  const recommendations = [...intel.recommendations].filter((r) => r.status === 'REVIEWABLE' || r.status === 'DRAFT').sort((a, b) => recRank(b) - recRank(a));

  return { needsAttention, opportunities, monitoring, dataIssues, recommendations };
}
