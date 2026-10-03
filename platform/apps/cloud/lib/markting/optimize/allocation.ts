/**
 * Phase 6I–6U — BUDGET ALLOCATION INTELLIGENCE. Review-only: this ranks where budget could be reviewed
 * for deployment or reduction; it NEVER executes. Algorithm choice (documented): a DETERMINISTIC GREEDY
 * marginal-value allocator over candidates sorted by a transparent priority score, stepping in bounded
 * increments and respecting hard constraints at every step. This is O(N log N + steps) — no
 * combinatorial explosion, no premature ML/LP. Every move exposes its reasons (see trace.ts).
 *
 * Profit-aware when merchant truth exists (contribution/MER over platform ROAS). Scaling confidence is
 * REDUCED (never auto-acted) for saturation, creative fatigue, inventory risk, and weak attribution.
 * Budget is never stolen from brand/strategic campaigns merely for higher direct ROAS (role-aware).
 */
import type { BiText } from '../intelligence/decision-model';
import {
  type Candidate, type HardConstraints, type SoftConstraints,
  maxAllowedForCandidate, minAllowedForCandidate, receiveEligible,
} from './constraints';

export type MoveDirection = 'UP_REVIEW' | 'DOWN_REVIEW' | 'HOLD';

export interface CandidateSignals {
  /** Performance vs a KNOWN target (ratio actual/target; >1 good for ROAS, <1 good for CPA). */
  beatingTarget?: boolean;
  targetKnown?: boolean;
  /** Marginal conversions per extra minor spend (from a valid response curve), if any. */
  marginalConversionsPerMinor?: number;
  withinResponseValidity?: boolean;
  saturation?: 'NO_SIGNAL' | 'SATURATION_SIGNAL' | 'STRONG_SATURATION_SIGNAL';
  creativeFatigue?: 'NO_SIGNAL' | 'WATCH' | 'FATIGUE_SIGNAL' | 'STRONG_FATIGUE_SIGNAL';
  inventoryRisk?: boolean;
  attribution?: 'DIRECTLY_TAGGED' | 'MERCHANT_LAST_TOUCH' | 'PLATFORM_REPORTED' | 'UNATTRIBUTED' | 'UNKNOWN';
  contributionMarginPct?: number;     // merchant truth, when known
  dataTrustOk?: boolean;              // evidence sufficiency gate
  scaleReady?: boolean;               // Phase-2 scaling readiness
}

export interface AllocationMove {
  candidateId: string;
  direction: MoveDirection;
  deltaMinor: number;                 // +raise / -reduce (review amount, not executed)
  fromMinor: number;
  toMinor: number;
  currency: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  flags: string[];                    // e.g. BUDGET_HOLD_PENDING_CREATIVE_REFRESH_REVIEW, INVENTORY_CONSTRAINT_PRESENT
  reasons: string[];
}

export interface AllocationResult {
  mode: 'ALLOCATE_EXTRA' | 'REDUCE';
  currency: string;
  totalMovedMinor: number;
  moves: AllocationMove[];
  unallocatedMinor: number;           // extra that could not be responsibly placed
  notes: BiText[];
}

/** Transparent scale-priority score in [−100, 100]. Higher = better candidate to RECEIVE budget. */
export function scalePriority(c: Candidate, s: CandidateSignals, soft: SoftConstraints): { score: number; confidence: AllocationMove['confidence']; flags: string[]; reasons: string[] } {
  const flags: string[] = []; const reasons: string[] = [];
  let score = 0; let conf = 2; // start HIGH, degrade

  // Positive evidence: beating a KNOWN target is the only thing that justifies scaling.
  if (s.targetKnown && s.beatingTarget) { score += 40; reasons.push('beating a known target'); }
  else if (!s.targetKnown) { score -= 20; conf -= 1; reasons.push('no known target — cannot confirm it wins'); }
  else { score -= 20; reasons.push('not beating target'); }

  if (s.scaleReady) { score += 20; reasons.push('scaling-ready (spend+conversions+stable+fresh)'); }
  if (s.marginalConversionsPerMinor != null && s.withinResponseValidity) { score += Math.min(20, s.marginalConversionsPerMinor * 1e6); reasons.push('positive marginal response within validity range'); }
  else if (s.marginalConversionsPerMinor != null && !s.withinResponseValidity) { conf -= 1; reasons.push('marginal response exists but target spend is outside validity range'); }

  // Profit-aware: a healthy contribution margin raises priority; thin margin lowers it.
  if (s.contributionMarginPct != null) { if (s.contributionMarginPct >= 20) { score += 15; reasons.push('healthy contribution margin'); } else if (s.contributionMarginPct < 0) { score -= 30; reasons.push('negative contribution margin'); } }

  // Saturation reduces scaling priority + confidence (signal, never proven). A STRONG signal HOLDs the
  // candidate out of scaling entirely (symmetric with creative fatigue) — do not scale into saturation.
  if (s.saturation === 'STRONG_SATURATION_SIGNAL') { score -= 30; conf -= 1; flags.push('SCALE_HOLD_PENDING_SATURATION_REVIEW'); reasons.push('strong saturation signal — held out of scaling'); }
  else if (s.saturation === 'SATURATION_SIGNAL') { score -= 15; reasons.push('saturation signal'); }

  // Creative fatigue → HOLD pending refresh review, not blind scaling.
  if (s.creativeFatigue === 'STRONG_FATIGUE_SIGNAL' || s.creativeFatigue === 'FATIGUE_SIGNAL') { score -= 25; conf -= 1; flags.push('BUDGET_HOLD_PENDING_CREATIVE_REFRESH_REVIEW'); reasons.push('dominant creative shows fatigue signal'); }

  // Inventory risk reduces confidence (never auto-reduces spend).
  if (s.inventoryRisk) { conf -= 1; flags.push('INVENTORY_CONSTRAINT_PRESENT'); reasons.push('inventory risk present — scaling confidence reduced'); }

  // Weak attribution reduces confidence.
  if (s.attribution === 'MERCHANT_LAST_TOUCH' || s.attribution === 'UNATTRIBUTED' || s.attribution === 'UNKNOWN') { conf -= 1; reasons.push('attribution is weak — confidence reduced'); }

  // Evidence sufficiency gate.
  if (s.dataTrustOk === false) { score -= 25; conf -= 1; reasons.push('evidence/data-trust insufficient'); }

  // Role protection: brand/strategic campaigns are not scaled/cut on direct ROAS alone.
  if ((c.role === 'brand' || c.role === 'strategic')) { reasons.push(`role=${c.role} — not ranked on direct ROAS alone`); if (soft.preserveBrandCampaigns) score -= 10; }

  // Soft preferences.
  if (soft.conservativeScaling) score -= 10;
  if (soft.favorProfitableGrowth && (s.contributionMarginPct ?? 0) >= 20) score += 10;
  if (soft.favorAcquisitionVolume && c.role === 'acquisition') score += 10;

  const confidence: AllocationMove['confidence'] = conf >= 2 ? 'HIGH' : conf === 1 ? 'MEDIUM' : 'LOW';
  return { score: Math.max(-100, Math.min(100, score)), confidence, flags, reasons };
}

const DEFAULT_STEPS = 20;

/**
 * Allocate an EXTRA budget amount across eligible candidates by greedy descending scale-priority, in
 * bounded increments, respecting hard caps. Candidates that are HOLD-flagged (creative fatigue) or
 * negative-score are not given budget. Returns review moves; nothing executes.
 */
export function allocateExtra(input: {
  extraMinor: number; currency: string; candidates: Array<{ candidate: Candidate; signals: CandidateSignals }>;
  hard: HardConstraints; soft?: SoftConstraints; steps?: number;
}): AllocationResult {
  const soft = input.soft ?? {};
  const steps = input.steps ?? DEFAULT_STEPS;
  const step = Math.max(1, Math.floor(input.extraMinor / steps));
  const scored = input.candidates
    .filter((x) => x.candidate.currency === input.currency && receiveEligible(x.candidate, input.hard).eligible)
    .map((x) => ({ ...x, ...scalePriority(x.candidate, x.signals, soft) }))
    .filter((x) => x.score > 0 && !x.flags.includes('BUDGET_HOLD_PENDING_CREATIVE_REFRESH_REVIEW') && !x.flags.includes('SCALE_HOLD_PENDING_SATURATION_REVIEW'))
    .sort((a, b) => b.score - a.score);

  // AGGREGATE org-budget guard: the org cap applies to the SUM across candidates, not per-candidate.
  // Track the running org total (current + already-allocated) so no step pushes the aggregate over it.
  const sameCurrency = input.candidates.filter((x) => x.candidate.currency === input.currency);
  const orgCurrentTotal = sameCurrency.reduce((a, x) => a + x.candidate.currentBudgetMinor, 0);
  const orgCap = input.hard.orgMaxBudgetMinor;

  const alloc = new Map<string, number>();
  let remaining = input.extraMinor;
  let allocatedTotal = 0;
  let orgCapReached = false;
  // Greedy: repeatedly give a step to the current best candidate with headroom.
  let guard = steps * Math.max(1, scored.length) + steps;
  while (remaining > 0 && scored.length > 0 && !orgCapReached && guard-- > 0) {
    let placed = false;
    for (const s of scored) {
      const orgHeadroom = orgCap != null ? orgCap - (orgCurrentTotal + allocatedTotal) : Number.POSITIVE_INFINITY;
      if (orgHeadroom <= 0) { orgCapReached = true; break; } // aggregate org cap hit — leftover stays unallocated
      const cap = maxAllowedForCandidate(s.candidate, input.hard);
      const current = s.candidate.currentBudgetMinor + (alloc.get(s.candidate.id) ?? 0);
      const headroom = cap - current;
      if (headroom <= 0) continue;
      const give = Math.min(step, headroom, remaining, orgHeadroom);
      if (give <= 0) continue;
      alloc.set(s.candidate.id, (alloc.get(s.candidate.id) ?? 0) + give);
      remaining -= give;
      allocatedTotal += give;
      placed = true;
      if (remaining <= 0) break;
    }
    if (!placed) break; // everyone capped out (per-candidate or aggregate org cap)
  }

  const moves: AllocationMove[] = scored.filter((s) => (alloc.get(s.candidate.id) ?? 0) > 0).map((s) => ({
    candidateId: s.candidate.id, direction: 'UP_REVIEW', deltaMinor: alloc.get(s.candidate.id)!,
    fromMinor: s.candidate.currentBudgetMinor, toMinor: s.candidate.currentBudgetMinor + alloc.get(s.candidate.id)!,
    currency: input.currency, confidence: s.confidence, flags: s.flags, reasons: s.reasons,
  }));
  const notes: BiText[] = [];
  if (remaining > 0) notes.push({ en: `${(remaining / 100).toFixed(2)} ${input.currency} left unallocated — no candidate has responsible headroom + evidence.`, ar: `${(remaining / 100).toFixed(2)} ${input.currency} لم تُوزَّع — لا مرشّح لديه مساحة ودليل كافٍ.` });
  const held = input.candidates.filter((x) => scalePriority(x.candidate, x.signals, soft).flags.includes('BUDGET_HOLD_PENDING_CREATIVE_REFRESH_REVIEW'));
  if (held.length) notes.push({ en: `${held.length} candidate(s) held pending creative-refresh review rather than scaled.`, ar: `${held.length} مرشّح محجوز بانتظار مراجعة تجديد الإبداع بدلًا من التوسيع.` });
  return { mode: 'ALLOCATE_EXTRA', currency: input.currency, totalMovedMinor: input.extraMinor - remaining, moves, unallocatedMinor: remaining, notes };
}

/**
 * Reduce total budget by an amount, taking from the LEAST-damaging candidates first (lowest scale
 * priority, not protected, above their floor). Review-only.
 */
export function reduceBudget(input: {
  reduceMinor: number; currency: string; candidates: Array<{ candidate: Candidate; signals: CandidateSignals }>;
  hard: HardConstraints; soft?: SoftConstraints; steps?: number;
}): AllocationResult {
  const soft = input.soft ?? {};
  const steps = input.steps ?? DEFAULT_STEPS;
  const step = Math.max(1, Math.floor(input.reduceMinor / steps));
  // Least damaging first = lowest scale priority first. Excluded from cuts: protected (minAllowed ==
  // current), experiment-excluded candidates (cutting an active-experiment arm would contaminate it),
  // and brand/strategic campaigns (never raided merely for lower direct performance — structural, not
  // just a soft preference), unless the caller explicitly opts into reducing brand/strategic.
  const protectRoles = input.soft?.preserveBrandCampaigns !== false; // default: protect brand/strategic
  const scored = input.candidates
    .filter((x) => x.candidate.currency === input.currency)
    .filter((x) => !input.hard.experimentExcludedIds?.includes(x.candidate.id))
    .filter((x) => !(protectRoles && (x.candidate.role === 'brand' || x.candidate.role === 'strategic')))
    .map((x) => ({ ...x, ...scalePriority(x.candidate, x.signals, soft) }))
    .filter((x) => minAllowedForCandidate(x.candidate, input.hard) < x.candidate.currentBudgetMinor)
    .sort((a, b) => a.score - b.score);

  const cut = new Map<string, number>();
  let remaining = input.reduceMinor;
  let guard = steps * Math.max(1, scored.length) + steps;
  while (remaining > 0 && scored.length > 0 && guard-- > 0) {
    let took = false;
    for (const s of scored) {
      const floor = minAllowedForCandidate(s.candidate, input.hard);
      const current = s.candidate.currentBudgetMinor - (cut.get(s.candidate.id) ?? 0);
      const room = current - floor;
      if (room <= 0) continue;
      const take = Math.min(step, room, remaining);
      if (take <= 0) continue;
      cut.set(s.candidate.id, (cut.get(s.candidate.id) ?? 0) + take);
      remaining -= take;
      took = true;
      if (remaining <= 0) break;
    }
    if (!took) break;
  }
  const moves: AllocationMove[] = scored.filter((s) => (cut.get(s.candidate.id) ?? 0) > 0).map((s) => ({
    candidateId: s.candidate.id, direction: 'DOWN_REVIEW', deltaMinor: -(cut.get(s.candidate.id)!),
    fromMinor: s.candidate.currentBudgetMinor, toMinor: s.candidate.currentBudgetMinor - cut.get(s.candidate.id)!,
    currency: input.currency, confidence: s.confidence, flags: s.flags, reasons: ['lowest scale-priority — least damaging reduction', ...s.reasons],
  }));
  const notes: BiText[] = [];
  if (remaining > 0) notes.push({ en: `Could not reduce the full amount without breaching floors/protected campaigns (${(remaining / 100).toFixed(2)} ${input.currency} short).`, ar: `تعذّر خفض كامل المبلغ دون المساس بالحدود/الحملات المحمية (${(remaining / 100).toFixed(2)} ${input.currency} متبقٍ).` });
  return { mode: 'REDUCE', currency: input.currency, totalMovedMinor: input.reduceMinor - remaining, moves, unallocatedMinor: remaining, notes };
}
