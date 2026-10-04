import 'server-only';
import { PRODUCTION_ACTIONS, ACTION_ALLOWLIST, type ProductionActionType } from './actions';

/**
 * PHASE C (C21) — MODE B WRITE-CONTROL READINESS REVIEW.
 *
 * This CLASSIFIES how close each already-allowlisted write type is to being safely enablable. It is a
 * read-only assessment: it changes no runtime flag, enables no write, and adds no new write type. Mode
 * B stays HELD regardless of what this returns (enabling is a separate, deliberate human action gated
 * by `MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY`, which this module cannot set).
 *
 * The verdict is a function of verified PREREQUISITES. Because live provider reads/writes are
 * BLOCKED_EXTERNAL in this environment (no credentials), the live-dependent prerequisites cannot be
 * verified, so no action can honestly reach READY_FOR_PRODUCTION_APPROVAL here — the review reports
 * exactly which prerequisites are met and which are blocked, never a fabricated "ready".
 */

export type ReadinessVerdict = 'NOT_READY' | 'READY_FOR_CONTROLLED_PILOT' | 'READY_FOR_PRODUCTION_APPROVAL';

/** The prerequisite gates a write type must clear. Each is a tri-state so "blocked" ≠ "failed". */
export type GateState = 'MET' | 'BLOCKED_EXTERNAL' | 'NOT_MET';

export interface ReadinessSignals {
  /** The full Phase-0 governed write path exists (recommendation→preview→approval→apply→audit). */
  governedPathImplemented: GateState;
  /** Apply-time revalidation re-checks ownership/entity/currency/current-value before the write. */
  applyTimeRevalidation: GateState;
  /** Idempotency + atomic claim + unknown-result reconciliation for this provider. */
  idempotencyAndReconcile: GateState;
  /** A rollback strategy exists for this action type. */
  rollbackStrategy: GateState;
  /** Kill-switch can halt this action scope immediately. */
  killSwitch: GateState;
  /** Observability: the write trace + alerts are delivered (not just modeled). */
  observabilityDelivered: GateState;
  /** Live provider write verified against a real sandbox/account (requires credentials). */
  liveWriteVerified: GateState;
  /** A controlled-pilot design with blast-radius limits + abort criteria is signed off. */
  controlledPilotDesign: GateState;
}

export interface ActionReadiness {
  action: ProductionActionType;
  verdict: ReadinessVerdict;
  metGates: string[];
  blockedGates: string[];
  unmetGates: string[];
  rationale: string;
}

const PILOT_GATES: Array<keyof ReadinessSignals> = [
  'governedPathImplemented', 'applyTimeRevalidation', 'idempotencyAndReconcile',
  'rollbackStrategy', 'killSwitch',
];
const PRODUCTION_EXTRA_GATES: Array<keyof ReadinessSignals> = [
  'observabilityDelivered', 'liveWriteVerified', 'controlledPilotDesign',
];

export function classifyActionReadiness(action: ProductionActionType, signals: ReadinessSignals): ActionReadiness {
  const met: string[] = [], blocked: string[] = [], unmet: string[] = [];
  for (const [gate, state] of Object.entries(signals) as Array<[keyof ReadinessSignals, GateState]>) {
    if (state === 'MET') met.push(gate);
    else if (state === 'BLOCKED_EXTERNAL') blocked.push(gate);
    else unmet.push(gate);
  }
  const pilotReady = PILOT_GATES.every((g) => signals[g] === 'MET');
  const productionReady = pilotReady && PRODUCTION_EXTRA_GATES.every((g) => signals[g] === 'MET');

  // RESUME_ENTITY has rollbackStrategy 'none' — it can only pilot where prior-active state proves
  // safety, so it is never promoted past controlled pilot by this review.
  const resumeCaveat = action === 'RESUME_ENTITY' && productionReady;

  let verdict: ReadinessVerdict;
  if (productionReady && !resumeCaveat) verdict = 'READY_FOR_PRODUCTION_APPROVAL';
  else if (pilotReady) verdict = 'READY_FOR_CONTROLLED_PILOT';
  else verdict = 'NOT_READY';

  const rationale = verdict === 'NOT_READY'
    ? `Core safety prerequisites not all met (missing: ${[...unmet, ...blocked].join(', ') || 'none'}).`
    : verdict === 'READY_FOR_CONTROLLED_PILOT'
    ? `Core safety stack met; production gates ${[...blocked, ...unmet].filter((g) => PRODUCTION_EXTRA_GATES.includes(g as keyof ReadinessSignals)).join(', ')} outstanding${resumeCaveat ? ' (RESUME_ENTITY capped at pilot: no rollback)' : ''}.`
    : 'All pilot and production prerequisites met.';

  return { action, verdict, metGates: met, blockedGates: blocked, unmetGates: unmet, rationale };
}

/**
 * The HONEST current-state review for this environment: the governed path, apply-time revalidation,
 * idempotency/reconcile, rollback (where defined), and kill-switch are implemented; observability
 * delivery, live write verification, and the signed pilot design are outstanding/blocked. Live write
 * verification is BLOCKED_EXTERNAL (no credentials).
 */
export function currentModeBReadiness(): ActionReadiness[] {
  return PRODUCTION_ACTIONS.map((action) => {
    const rollback: GateState = ACTION_ALLOWLIST[action].rollbackStrategy === 'none' ? 'NOT_MET' : 'MET';
    return classifyActionReadiness(action, {
      governedPathImplemented: 'MET',
      applyTimeRevalidation: 'MET',
      idempotencyAndReconcile: 'MET',
      rollbackStrategy: rollback,
      killSwitch: 'MET',
      observabilityDelivered: 'NOT_MET',     // rules+dedup modeled; delivery/escalation not wired
      liveWriteVerified: 'BLOCKED_EXTERNAL',  // no provider credentials in this environment
      controlledPilotDesign: 'NOT_MET',       // designed in docs/phase-c/16; not signed off / launched
    });
  });
}
