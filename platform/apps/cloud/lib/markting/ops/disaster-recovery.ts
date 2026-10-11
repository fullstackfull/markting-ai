import 'server-only';
import {
  recommendRecovery,
  recoveryPermitsExecution,
  type RecoveryCondition,
  type RecoveryPlan,
} from './connection-recovery';
import type { PaginateStop } from './provider-pagination';

/**
 * PHASE C.6 (39) — DISASTER-RECOVERY PREP (pure model; no infra, no network).
 *
 * A credential-free DR model: RPO/RTO targets, the backup/restore CONTRACT (what MUST be captured to
 * recover), a manifest validator that FAILS CLOSED when any critical artifact is missing or stale, and a
 * replay/recovery planner that computes the resume action for a given crash point — reusing the
 * connection-recovery table and the executor's resumeCursor semantics so recovery never double-writes or
 * loses data. Actual backup/restore EXECUTION is BLOCKED_EXTERNAL (needs infra + credentials): it is a
 * clearly-marked stub that throws, never an autonomous action.
 */

// ---- RPO / RTO targets (internal recovery objectives, not customer SLAs) ----
/** Recovery Point Objective: the maximum tolerable data loss window — a backup older than this is STALE. */
export const RPO_TARGET_MS = 15 * 60_000;
/** Recovery Time Objective: the maximum tolerable time to restore service after a disaster. */
export const RTO_TARGET_MS = 60 * 60_000;

// ---- Backup/restore contract ----
export const DR_ARTIFACTS = [
  'SCHEMA_MIGRATIONS',
  'ENCRYPTED_SECRET_REFS',
  'CONNECTION_STATE',
  'IN_FLIGHT_SYNC_CURSORS',
  'IDEMPOTENCY_KEYS',
  'AUDIT_LOG',
  'QUARANTINE_AGGREGATES',
] as const;
export type DrArtifact = (typeof DR_ARTIFACTS)[number];

export interface DrArtifactSpec {
  /** A missing critical artifact makes a restore INCOMPLETE (validator fails closed). */
  critical: boolean;
  /** What recovering this artifact restores — rendered in the DR runbook. Never a secret VALUE. */
  recoveryRole: string;
}

/**
 * The exhaustive capture contract. `Record<DrArtifact, …>` makes it a compile error to add an artifact
 * without declaring whether it is critical. CRITICAL = recovery is unsafe/incomplete without it.
 * ENCRYPTED_SECRET_REFS captures only the KMS/secret-manager REFERENCES (never the plaintext secrets).
 */
export const BACKUP_CONTRACT: Record<DrArtifact, DrArtifactSpec> = {
  SCHEMA_MIGRATIONS: { critical: true, recoveryRole: 'The exact migration version to rebuild the schema a restore is read against.' },
  ENCRYPTED_SECRET_REFS: { critical: true, recoveryRole: 'References to the encrypted provider grants/keys (never plaintext) so connections can be re-bound.' },
  CONNECTION_STATE: { critical: true, recoveryRole: 'Each connection lifecycle state so recovery resumes governance, not a blind CONNECTED.' },
  IN_FLIGHT_SYNC_CURSORS: { critical: true, recoveryRole: 'Resumable pagination cursors so sync reads continue, not restart — no lost or re-read windows.' },
  IDEMPOTENCY_KEYS: { critical: true, recoveryRole: 'Operation claims/keys so an in-flight write is reconciled, never blind-replayed into a double write.' },
  AUDIT_LOG: { critical: false, recoveryRole: 'The append-only audit trail; recoverable separately, not required to resume execution safely.' },
  QUARANTINE_AGGREGATES: { critical: false, recoveryRole: 'Deduplicated quarantine counts; data-quality history, rebuildable from re-ingest.' },
};

/** The critical artifacts, in contract order. */
export function criticalArtifacts(): DrArtifact[] {
  return DR_ARTIFACTS.filter((a) => BACKUP_CONTRACT[a].critical);
}

// ---- Restore manifest + validation ----
export interface ArtifactCapture {
  /** Epoch ms the artifact was captured (drives RPO staleness). */
  capturedAtMs: number;
  /** Count of items captured (0 is legitimate — e.g. no in-flight cursors — and does NOT fail validation). */
  itemCount: number;
  /** A content hash / backup object reference — a REFERENCE only, never a secret value. */
  ref: string;
}

export interface RestoreManifest {
  backupId: string;
  /** Captured artifacts keyed by kind; a kind absent here is treated as NOT captured. */
  artifacts: Partial<Record<DrArtifact, ArtifactCapture>>;
}

export interface ManifestValidation {
  /** Every CRITICAL artifact is present. */
  complete: boolean;
  /** No critical artifact is older than the RPO window. */
  rpoMet: boolean;
  /** complete AND rpoMet — the only state from which a restore may proceed. */
  valid: boolean;
  missingCritical: DrArtifact[];
  staleCritical: DrArtifact[];
  /** The oldest critical capture time (the effective recovery point), or null when none present. */
  oldestCriticalCaptureMs: number | null;
}

/**
 * Validate a restore manifest. FAILS CLOSED: an empty manifest, any missing critical artifact, or any
 * critical capture older than the RPO window yields valid=false. Deterministic clock injectable. Pure.
 */
export function validateRestoreManifest(manifest: RestoreManifest, opts: { nowMs: number; rpoMs?: number }): ManifestValidation {
  const rpoMs = opts.rpoMs ?? RPO_TARGET_MS;
  const missingCritical: DrArtifact[] = [];
  const staleCritical: DrArtifact[] = [];
  let oldestCriticalCaptureMs: number | null = null;

  for (const kind of criticalArtifacts()) {
    const cap = manifest.artifacts[kind];
    if (!cap) {
      missingCritical.push(kind);
      continue;
    }
    if (opts.nowMs - cap.capturedAtMs > rpoMs) staleCritical.push(kind);
    if (oldestCriticalCaptureMs == null || cap.capturedAtMs < oldestCriticalCaptureMs) oldestCriticalCaptureMs = cap.capturedAtMs;
  }

  const complete = missingCritical.length === 0;
  const rpoMet = complete && staleCritical.length === 0;
  return { complete, rpoMet, valid: complete && rpoMet, missingCritical, staleCritical, oldestCriticalCaptureMs };
}

// ---- Backup freshness (RPO monitoring) ----
export type BackupFreshness = 'OK' | 'STALE' | 'MISSING';

/** Classify the most recent successful backup against the RPO window. MISSING fails closed as not-OK. */
export function backupFreshness(lastBackupAtMs: number | null, nowMs: number, rpoMs = RPO_TARGET_MS): BackupFreshness {
  if (lastBackupAtMs == null) return 'MISSING';
  return nowMs - lastBackupAtMs > rpoMs ? 'STALE' : 'OK';
}

// ---- Replay / recovery planner ----
export type CrashPhase = 'SYNC_READ_IN_FLIGHT' | 'PROVIDER_WRITE_IN_FLIGHT' | 'QUEUE_IDLE';

export interface CrashContext {
  phase: CrashPhase;
  provider: string;
  /** Observed connection condition at recovery time — reuses the connection-recovery table verbatim. */
  connectionCondition?: RecoveryCondition;
  // --- SYNC_READ_IN_FLIGHT (executor resumeCursor semantics) ---
  /** The cursor the crashed read stopped at (null = COMPLETE / nothing to resume). */
  resumeCursor?: string | null;
  paginationStop?: PaginateStop;
  // --- PROVIDER_WRITE_IN_FLIGHT (idempotency semantics) ---
  /** Did the operation acquire its atomic claim before the crash? */
  writeClaimed?: boolean;
  /** Did we durably observe the provider's success ack? */
  writeAcknowledged?: boolean;
  /** Does the provider support an idempotency key (safe re-send) vs. reconcile-only? */
  providerSupportsIdempotencyKey?: boolean;
}

export type DrResumeAction =
  | 'NO_ACTION'
  | 'RESUME_FROM_CURSOR'
  | 'RESTART_READ'
  | 'RECONCILE_BEFORE_RETRY'
  | 'SAFE_RETRY_IDEMPOTENT'
  | 'AWAIT_CONNECTION_RECOVERY'
  | 'NO_EXECUTION';

export interface DrRecoveryPlan {
  action: DrResumeAction;
  /** The reused connection-recovery plan when a connection condition gates recovery. */
  connectionRecovery?: RecoveryPlan;
  /** True only when the plan cannot guarantee no lost data. */
  dataLossRisk: boolean;
  /** True only when the plan cannot yet guarantee no double write (until reconciliation proves it). */
  doubleWriteRisk: boolean;
  reason: string;
}

/**
 * Compute the resume action for a crash point so recovery NEVER double-writes or loses data. Connection
 * health gates everything: a DISABLED hold blocks execution, and any other unresolved condition routes to
 * AWAIT_CONNECTION_RECOVERY (the cursor/claim is retained, so nothing is lost by waiting). Pure + total.
 */
export function planRecovery(crash: CrashContext): DrRecoveryPlan {
  // Connection health first — never resume I/O under an unresolved condition.
  if (crash.connectionCondition) {
    const rec = recommendRecovery(crash.connectionCondition);
    if (!recoveryPermitsExecution(crash.connectionCondition)) {
      return { action: 'NO_EXECUTION', connectionRecovery: rec, dataLossRisk: false, doubleWriteRisk: false, reason: `Connection ${crash.connectionCondition} forbids execution; retained state resumes once cleared.` };
    }
    return { action: 'AWAIT_CONNECTION_RECOVERY', connectionRecovery: rec, dataLossRisk: false, doubleWriteRisk: false, reason: `Resolve connection condition (${rec.action}) before resuming; cursor/claim retained, nothing lost by waiting.` };
  }

  if (crash.phase === 'QUEUE_IDLE') {
    return { action: 'NO_ACTION', dataLossRisk: false, doubleWriteRisk: false, reason: 'No work was in flight at the crash point.' };
  }

  if (crash.phase === 'SYNC_READ_IN_FLIGHT') {
    if (crash.paginationStop === 'COMPLETE' || crash.resumeCursor == null) {
      if (crash.paginationStop === 'COMPLETE') return { action: 'NO_ACTION', dataLossRisk: false, doubleWriteRisk: false, reason: 'The read had completed; no resume needed.' };
      return { action: 'RESTART_READ', dataLossRisk: false, doubleWriteRisk: false, reason: 'No resumable cursor was captured; a full read restart re-fetches the window (reads upsert, so no double write).' };
    }
    return { action: 'RESUME_FROM_CURSOR', dataLossRisk: false, doubleWriteRisk: false, reason: 'Resume from the captured cursor; reads are idempotent (upsert), so no window is lost or double-written.' };
  }

  // PROVIDER_WRITE_IN_FLIGHT
  if (!crash.writeClaimed) {
    return { action: 'NO_ACTION', dataLossRisk: false, doubleWriteRisk: false, reason: 'No atomic claim was taken; the write never executed, so there is nothing to recover.' };
  }
  if (crash.writeAcknowledged) {
    return { action: 'NO_ACTION', dataLossRisk: false, doubleWriteRisk: false, reason: 'The write was durably acknowledged before the crash; it is already recorded.' };
  }
  // Claimed but unacknowledged → UNKNOWN_RESULT. Never a blind resend.
  if (crash.providerSupportsIdempotencyKey) {
    return { action: 'SAFE_RETRY_IDEMPOTENT', dataLossRisk: false, doubleWriteRisk: false, reason: 'Result unknown, but the provider idempotency key dedupes a retry — a re-send cannot double-write.' };
  }
  return { action: 'RECONCILE_BEFORE_RETRY', dataLossRisk: false, doubleWriteRisk: true, reason: 'Result unknown and no idempotency key — reconcile the provider state before any retry; never blind-replay.' };
}

// ---- Backup/restore EXECUTION — BLOCKED_EXTERNAL (needs infra + credentials) ----
export const DR_EXECUTION_BLOCKED_MARKER = 'BLOCKED_EXTERNAL:dr-execution-needs-infra';

export class DrExecutionBlockedError extends Error {
  readonly marker = DR_EXECUTION_BLOCKED_MARKER;
  constructor(op: 'backup' | 'restore') {
    super(`${DR_EXECUTION_BLOCKED_MARKER} (${op}): snapshot/restore execution requires provisioned infra + credentials; blocked in this environment`);
    this.name = 'DrExecutionBlockedError';
  }
}

/**
 * Stub for the real snapshot execution. It is NOT wired (no infra/credentials) and takes NO autonomous
 * action: it throws so a caller can never trigger a silent live backup. The planning/validation above is
 * the credential-free part that production drives before invoking the real executor.
 */
export function executeBackupSnapshot(): never {
  throw new DrExecutionBlockedError('backup');
}

/** Stub for the real restore execution. Not wired; throws. No autonomous action. */
export function executeRestore(): never {
  throw new DrExecutionBlockedError('restore');
}
