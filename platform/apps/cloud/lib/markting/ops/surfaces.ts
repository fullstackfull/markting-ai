/**
 * Phase 7U/7V/7H — enterprise surfaces: Approval Center, Audit Center, Agency Dashboard, and operational
 * reporting. READ surfaces for humans; none carries an execution affordance that bypasses the governed
 * path. Money is never summed across currencies without governed FX (mixed → shown separately).
 */
import type { BiText } from '../intelligence/decision-model';
import type { OperationState } from './state-machine';
import type { ClientIdentityBanner } from './agency';

// ---- Approval Center (7V) ----
export interface ApprovalCard {
  operationId: string;
  identity: ClientIdentityBanner;              // agency/client/workspace/account — shown prominently
  provider: string;
  campaign?: string;
  recommendation?: BiText;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  moneyDelta?: { minorUnits: number; currency: string };
  risk: string;
  confidence: string;
  evidence: Record<string, unknown>;
  requesterUserId: string;
  requiredApprovers: number;
  requireSenior: boolean;
  collectedApprovers: number;
  expiresAt: string;
  state: OperationState;
  /** The approver must know EXACTLY what will happen — this is the literal diff, not a summary. */
  exactChange: BiText;
}

export function buildApprovalCard(input: Omit<ApprovalCard, 'exactChange'>): ApprovalCard {
  const beforeAfter = `${JSON.stringify(input.before)} → ${JSON.stringify(input.after)}`;
  return { ...input, exactChange: { en: `${input.action}: ${beforeAfter} on ${input.identity.clientOrganizationId}/${input.identity.accountId ?? '?'} (${input.provider}).`, ar: `${input.action}: ${beforeAfter} على ${input.identity.clientOrganizationId}/${input.identity.accountId ?? '؟'} (${input.provider}).` } };
}

// ---- Audit Center (7U) ----
export interface AuditFilter { userId?: string; organizationId?: string; accountId?: string; provider?: string; action?: string; from?: string; to?: string; result?: string; risk?: string }
export interface AuditRow { id: string; at: string; actor?: string; organizationId: string; accountId?: string; provider: string; action: string; result: string; risk?: string; approvalRef?: string; recommendationRef?: string }

/** Audit rows are IMMUTABLE (append-only in the DB); the center only reads/filters/exports them. */
export function filterAudit(rows: AuditRow[], f: AuditFilter): AuditRow[] {
  return rows.filter((r) =>
    (!f.userId || r.actor === f.userId) && (!f.organizationId || r.organizationId === f.organizationId) &&
    (!f.accountId || r.accountId === f.accountId) && (!f.provider || r.provider === f.provider) &&
    (!f.action || r.action === f.action) && (!f.result || r.result === f.result) && (!f.risk || r.risk === f.risk) &&
    (!f.from || r.at >= f.from) && (!f.to || r.at <= f.to));
}

// ---- Agency Dashboard (7H) ----
export interface AgencyDashboard {
  clientsNeedingAttention: Array<{ clientOrganizationId: string; reasons: string[] }>;
  recommendationQueue: number;
  approvalQueue: number;
  spendByCurrency: Record<string, number>;     // NEVER a blended total — keyed by currency
  dataHealth: Array<{ clientOrganizationId: string; state: string }>;
  connectionHealth: Array<{ clientOrganizationId: string; provider: string; state: string }>;
  aiUsageMicros: number;
  failedSyncs: number;
  failedOperations: number;
  mixedCurrencyNote?: BiText;
}

export function buildAgencyDashboard(input: Omit<AgencyDashboard, 'mixedCurrencyNote'>): AgencyDashboard {
  const mixed = Object.keys(input.spendByCurrency).length > 1;
  return { ...input, mixedCurrencyNote: mixed ? { en: 'Spend is shown per currency and is NOT blended into a single total (no governed FX).', ar: 'يُعرض الإنفاق لكل عملة ولا يُدمج في إجمالي واحد (لا FX محكوم).' } : undefined };
}

// ---- Enterprise reporting (operational, not vanity) ----
export interface OperationalReport {
  approvalAging: Array<{ operationId: string; ageMs: number }>;
  failedOperations: number;
  writeVolume: number;
  providerReliability: Record<string, { success: number; failure: number; unknown: number }>;
  aiCostMicros: number;
  recommendationToApprovalConversion: number;   // approved / recommended
  outcomeCoveragePct: number;                    // operations with an outcome linked / applied
}

/** Build the operational report. Deliberately NO "AI success score" vanity metric. */
export function buildOperationalReport(input: OperationalReport): OperationalReport { return input; }
