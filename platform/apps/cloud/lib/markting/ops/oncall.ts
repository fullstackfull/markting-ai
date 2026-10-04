import 'server-only';
import { escalationFor, type SevLevel } from './incident-escalation';

/**
 * PHASE C.6 (item 21) — ON-CALL ABSTRACTION.
 *
 * A port that answers "who is on call for this SEV level, right now?". Keeping it an interface means the
 * escalation path never hard-codes a roster or a vendor.
 *
 * Two credential-free implementations ship here:
 *   - {@link StaticOnCallResolver} — a configured rota/map (SEV level → assignee). Pure, deterministic.
 *   - {@link NoopOnCallResolver}   — always returns null. The SAFE fallback when no rota is configured.
 *
 * BLOCKED_EXTERNAL: a real PagerDuty / Opsgenie-backed resolver is OPTIONAL and intentionally NOT built
 * here. It would implement this same {@link OnCallResolver} port and perform a live schedule lookup; that
 * (and its credentials) is a deploy-time concern. Until one is wired, StaticOnCallResolver or
 * NoopOnCallResolver is used, so the system always has a safe, credential-free on-call answer.
 */

export interface OnCallAssignment {
  sev: SevLevel;
  /** The owning role for this SEV (defaults to the escalation policy's role when the rota omits it). */
  operatorRole: string;
  /** The on-call operator's id. */
  operatorId: string;
  /** A human-readable name for the on-call operator. */
  displayName: string;
  /** The clock value the assignment was resolved at (injected, never read internally). */
  resolvedAtMs: number;
}

export interface OnCallResolver {
  /** Resolve the on-call assignment for a SEV level at `now`, or null when nobody is assigned. */
  resolve(sev: SevLevel, now: number): OnCallAssignment | null;
}

export interface StaticOnCallEntry {
  operatorId: string;
  displayName: string;
  /** Optional role override; defaults to the escalation policy's role for the SEV. */
  operatorRole?: string;
}

/** Resolver backed by a static, in-memory rota (SEV level → assignee). Pure and deterministic. */
export class StaticOnCallResolver implements OnCallResolver {
  constructor(private readonly rota: Partial<Record<SevLevel, StaticOnCallEntry>>) {}

  resolve(sev: SevLevel, now: number): OnCallAssignment | null {
    const entry = this.rota[sev];
    if (!entry) return null;
    return {
      sev,
      operatorRole: entry.operatorRole ?? escalationFor(sev).operatorRole,
      operatorId: entry.operatorId,
      displayName: entry.displayName,
      resolvedAtMs: now,
    };
  }
}

/** The safe fallback: nobody is ever resolved. Used when no rota/vendor is configured. */
export class NoopOnCallResolver implements OnCallResolver {
  resolve(_sev: SevLevel, _now: number): OnCallAssignment | null {
    return null;
  }
}
