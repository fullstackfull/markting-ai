/**
 * PHASE C.6 (17) — formal CONNECTION LIFECYCLE STATE MACHINE.
 *
 * A connection is always in exactly one canonical lifecycle state. Illegal transitions are refused
 * server-side (mirroring the execution state-machine in ./state-machine.ts) so a connection can never
 * jump, for example, from NOT_CONFIGURED straight to CONNECTED without going through CONNECTING, or from
 * REVOKED back to CONNECTED without a fresh authorization. Every legal transition yields an auditable
 * event {from,to,reason,at} that the connection audit trail appends; the state itself is persisted by
 * the caller. Pure, deterministic, no DB/network/secrets/model.
 *
 * This is the coarse LIFECYCLE vocabulary (how a connection moves over time). It is deliberately distinct
 * from, but consistent with, the fine-grained point-in-time status vocabulary in
 * lib/connections/vocabulary.ts (CONNECTED, DEGRADED, REAUTH_REQUIRED, EXPIRED, DISABLED, …): the status
 * is a pure function of current signals, whereas the lifecycle records the governed path between them.
 */
export const CONNECTION_LIFECYCLE_STATES = [
  'NOT_CONFIGURED',
  'CONNECTING',
  'CONNECTED',
  'DEGRADED',
  'REAUTH_REQUIRED',
  'EXPIRED',
  'DISABLED',
  'REVOKED',
  'DISCONNECTED',
  'ERROR',
] as const;
export type ConnectionLifecycleState = (typeof CONNECTION_LIFECYCLE_STATES)[number];

/**
 * Legal transition table. Every arrow is intentional:
 *  - the only way INTO CONNECTED is via CONNECTING (a completed authorization) or a recovery from a
 *    degraded/error/expired/disabled state — never straight from NOT_CONFIGURED/REVOKED/DISCONNECTED;
 *  - REVOKED and DISCONNECTED (grant gone) can only be re-established by starting a fresh CONNECTING flow;
 *  - DISABLED is an operator hold: it resumes to a re-verification (CONNECTING) or tears down, never a
 *    blind jump back to CONNECTED as if nothing happened;
 *  - EXPIRED/REAUTH_REQUIRED route through CONNECTING (refresh or reauthorize), not a silent revival.
 */
const TRANSITIONS: Record<ConnectionLifecycleState, ConnectionLifecycleState[]> = {
  NOT_CONFIGURED: ['CONNECTING', 'DISABLED'],
  CONNECTING: ['CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'NOT_CONFIGURED', 'DISCONNECTED'],
  CONNECTED: ['DEGRADED', 'REAUTH_REQUIRED', 'EXPIRED', 'DISABLED', 'REVOKED', 'DISCONNECTED', 'ERROR'],
  DEGRADED: ['CONNECTED', 'REAUTH_REQUIRED', 'EXPIRED', 'DISABLED', 'REVOKED', 'DISCONNECTED', 'ERROR'],
  REAUTH_REQUIRED: ['CONNECTING', 'EXPIRED', 'DISABLED', 'REVOKED', 'DISCONNECTED'],
  EXPIRED: ['CONNECTING', 'REAUTH_REQUIRED', 'DISABLED', 'REVOKED', 'DISCONNECTED'],
  DISABLED: ['CONNECTING', 'NOT_CONFIGURED', 'DISCONNECTED', 'REVOKED'],
  REVOKED: ['CONNECTING', 'DISCONNECTED', 'NOT_CONFIGURED'],
  DISCONNECTED: ['CONNECTING', 'NOT_CONFIGURED'],
  ERROR: ['CONNECTING', 'CONNECTED', 'DEGRADED', 'REAUTH_REQUIRED', 'EXPIRED', 'DISABLED', 'REVOKED', 'DISCONNECTED'],
};

export function canTransition(from: ConnectionLifecycleState, to: ConnectionLifecycleState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** The legal next states from a given lifecycle state (copy; never the backing array). */
export function allowedTransitions(from: ConnectionLifecycleState): ConnectionLifecycleState[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export class IllegalConnectionTransitionError extends Error {
  constructor(public from: ConnectionLifecycleState, public to: ConnectionLifecycleState) {
    super(`illegal connection transition ${from} → ${to}`);
    this.name = 'IllegalConnectionTransitionError';
  }
}

/** Assert a transition is legal; throw server-side otherwise. Pure guard — callers persist the state. */
export function assertConnectionTransition(from: ConnectionLifecycleState, to: ConnectionLifecycleState): void {
  if (!canTransition(from, to)) throw new IllegalConnectionTransitionError(from, to);
}

/** An auditable lifecycle event, appended to the connection audit trail on every legal transition. */
export interface ConnectionTransitionEvent {
  from: ConnectionLifecycleState;
  to: ConnectionLifecycleState;
  reason: string;
  /** ISO-8601 timestamp of the transition. */
  at: string;
}

/**
 * Perform a governed transition. Returns the auditable event on success; throws
 * IllegalConnectionTransitionError on an illegal move. Deterministic clock injectable for tests.
 */
export function transitionConnection(
  from: ConnectionLifecycleState,
  to: ConnectionLifecycleState,
  reason: string,
  opts: { now?: () => number } = {},
): ConnectionTransitionEvent {
  assertConnectionTransition(from, to);
  const at = new Date(opts.now ? opts.now() : Date.now()).toISOString();
  return { from, to, reason, at };
}

/** Resting states — a connection can sit here indefinitely with no in-flight work (not strictly terminal). */
export function isRestingState(state: ConnectionLifecycleState): boolean {
  return state === 'NOT_CONFIGURED' || state === 'DISCONNECTED' || state === 'REVOKED' || state === 'DISABLED';
}

// ───────────────────────────── OAuth callback hardening guards (C.6 item 16) ─────────────────────────
//
// Pure, deterministic guards for the OAuth callback. The AUTHORITATIVE enforcement lives in the DB-backed
// consumeOAuthTransaction (lib/cloud/repository.ts), which cannot run here without credentials/Postgres —
// the live code-for-token exchange is therefore BLOCKED_EXTERNAL. These guards model the exact invariants
// that gate the CONNECTING → CONNECTED transition so they are unit-testable with no network: a callback is
// only honored when its single-use state is bound to the same provider/user/tenant it was minted for, has
// not been consumed (replay), has not expired, and arrived on a trusted origin. Account discovery (listing
// accessible provider accounts after the callback) is gated on an OK binding — never run on a rejected one.

/** The stored start-of-flow record (what createOAuthTransaction persisted), as plain data. */
export interface OAuthStateRecord {
  provider: string;
  /** User the flow was initiated by (binding). */
  userId: string;
  /** Tenant the flow was initiated for (binding). */
  organizationId: string;
  /** digestState(state) recorded at start — the single-use lookup key. */
  stateHash: string;
  /** Epoch ms when the record was already consumed, if ever (replay guard). */
  consumedAt?: number | null;
  /** Epoch ms expiry (the start route sets +10 minutes). */
  expiresAt: number;
}

/** The claim presented by an inbound callback, after the session was re-validated. */
export interface OAuthCallbackClaim {
  provider: string;
  /** User id from the re-validated session at callback time. */
  userId: string;
  /** digestState(callback `state` param). */
  stateHash: string;
  /** The tenant the re-validated session is acting for (binding). */
  organizationId: string;
  /** Whether the callback arrived on the configured public origin (not the inbound Host header). */
  originOk: boolean;
}

export type CallbackGuardReason =
  | 'OK'
  | 'UNKNOWN_STATE'
  | 'STATE_REUSED'
  | 'STATE_EXPIRED'
  | 'USER_MISMATCH'
  | 'ORG_MISMATCH'
  | 'PROVIDER_MISMATCH'
  | 'ORIGIN_REJECTED';

export interface CallbackGuardResult {
  ok: boolean;
  reason: CallbackGuardReason;
}

/**
 * Evaluate whether an OAuth callback may advance the connection. `record` is the stored transaction found
 * by the callback's state hash (null when no row matches — an unknown/forged state). Deterministic clock
 * injectable. This is a pure decision function; the caller consumes the row + persists the transition.
 */
export function evaluateCallbackBinding(
  record: OAuthStateRecord | null,
  claim: OAuthCallbackClaim,
  opts: { now?: () => number } = {},
): CallbackGuardResult {
  const now = opts.now ? opts.now() : Date.now();
  // Origin is checked first: a callback from an untrusted origin is never looked up.
  if (!claim.originOk) return { ok: false, reason: 'ORIGIN_REJECTED' };
  // Unknown/forged state — no record matched the presented state hash.
  if (!record || record.stateHash !== claim.stateHash) return { ok: false, reason: 'UNKNOWN_STATE' };
  // Replay — the single-use state was already consumed.
  if (record.consumedAt != null) return { ok: false, reason: 'STATE_REUSED' };
  // Expiration — the state is only valid inside its window.
  if (now >= record.expiresAt) return { ok: false, reason: 'STATE_EXPIRED' };
  // Provider binding — the callback must be for the provider the state was minted for.
  if (record.provider !== claim.provider) return { ok: false, reason: 'PROVIDER_MISMATCH' };
  // User binding — membership/session may have changed on the consent screen.
  if (record.userId !== claim.userId) return { ok: false, reason: 'USER_MISMATCH' };
  // Tenant binding — the grant is stored under, and re-authorized against, the initiating tenant.
  if (record.organizationId !== claim.organizationId) return { ok: false, reason: 'ORG_MISMATCH' };
  return { ok: true, reason: 'OK' };
}

/**
 * Account discovery (listing accessible provider accounts right after the callback) is GATED: it may only
 * run once the callback binding is OK and a grant has actually been stored. A rejected binding never
 * reaches provider I/O.
 */
export function accountDiscoveryAllowed(guard: CallbackGuardResult, grantStored: boolean): boolean {
  return guard.ok && grantStored;
}
