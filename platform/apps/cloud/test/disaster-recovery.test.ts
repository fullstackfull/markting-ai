import { describe, expect, it } from 'vitest';
import {
  RPO_TARGET_MS,
  RTO_TARGET_MS,
  DR_ARTIFACTS,
  BACKUP_CONTRACT,
  criticalArtifacts,
  validateRestoreManifest,
  backupFreshness,
  planRecovery,
  executeBackupSnapshot,
  executeRestore,
  DrExecutionBlockedError,
  DR_EXECUTION_BLOCKED_MARKER,
  type RestoreManifest,
  type ArtifactCapture,
  type DrArtifact,
} from '@/lib/markting/ops/disaster-recovery';

const NOW = 1_700_000_000_000;
const cap = (capturedAtMs: number, over: Partial<ArtifactCapture> = {}): ArtifactCapture => ({ capturedAtMs, itemCount: 3, ref: 'sha256:abc', ...over });

function fullManifest(capturedAtMs: number): RestoreManifest {
  const artifacts: Partial<Record<DrArtifact, ArtifactCapture>> = {};
  for (const a of DR_ARTIFACTS) artifacts[a] = cap(capturedAtMs);
  return { backupId: 'bk_1', artifacts };
}

describe('ITEM 39 — DR targets + capture contract', () => {
  it('declares sane RPO/RTO targets (RPO tighter than RTO)', () => {
    expect(RPO_TARGET_MS).toBeGreaterThan(0);
    expect(RTO_TARGET_MS).toBeGreaterThan(RPO_TARGET_MS);
  });

  it('marks the five recovery-critical artifacts as critical', () => {
    const critical = new Set(criticalArtifacts());
    for (const a of ['SCHEMA_MIGRATIONS', 'ENCRYPTED_SECRET_REFS', 'CONNECTION_STATE', 'IN_FLIGHT_SYNC_CURSORS', 'IDEMPOTENCY_KEYS'] as const) {
      expect(critical.has(a)).toBe(true);
      expect(BACKUP_CONTRACT[a].critical).toBe(true);
    }
    // Audit/quarantine are recoverable separately — not required to resume execution safely.
    expect(BACKUP_CONTRACT.AUDIT_LOG.critical).toBe(false);
    expect(BACKUP_CONTRACT.QUARANTINE_AGGREGATES.critical).toBe(false);
  });

  it('every contract spec carries a secret-free recovery role', () => {
    for (const a of DR_ARTIFACTS) {
      expect(BACKUP_CONTRACT[a].recoveryRole.length).toBeGreaterThan(0);
    }
  });
});

describe('ITEM 39 — restore manifest validation (fails closed)', () => {
  it('accepts a complete, fresh manifest', () => {
    const v = validateRestoreManifest(fullManifest(NOW - 60_000), { nowMs: NOW });
    expect(v.complete).toBe(true);
    expect(v.rpoMet).toBe(true);
    expect(v.valid).toBe(true);
    expect(v.missingCritical).toHaveLength(0);
    expect(v.oldestCriticalCaptureMs).toBe(NOW - 60_000);
  });

  it('fails closed when ANY critical artifact is missing', () => {
    const m = fullManifest(NOW - 60_000);
    delete m.artifacts.IDEMPOTENCY_KEYS;
    const v = validateRestoreManifest(m, { nowMs: NOW });
    expect(v.complete).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.missingCritical).toContain('IDEMPOTENCY_KEYS');
  });

  it('fails closed on an empty manifest (all critical missing)', () => {
    const v = validateRestoreManifest({ backupId: 'empty', artifacts: {} }, { nowMs: NOW });
    expect(v.valid).toBe(false);
    expect(v.missingCritical).toEqual(criticalArtifacts());
    expect(v.oldestCriticalCaptureMs).toBeNull();
  });

  it('is complete but RPO-violating when a critical artifact is stale', () => {
    const m = fullManifest(NOW - 60_000);
    m.artifacts.CONNECTION_STATE = cap(NOW - (RPO_TARGET_MS + 60_000));
    const v = validateRestoreManifest(m, { nowMs: NOW });
    expect(v.complete).toBe(true);
    expect(v.rpoMet).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.staleCritical).toContain('CONNECTION_STATE');
  });

  it('treats a zero-item capture as present (not missing)', () => {
    const m = fullManifest(NOW - 10_000);
    m.artifacts.IN_FLIGHT_SYNC_CURSORS = cap(NOW - 10_000, { itemCount: 0 });
    const v = validateRestoreManifest(m, { nowMs: NOW });
    expect(v.valid).toBe(true);
  });
});

describe('ITEM 39 — backup freshness against RPO', () => {
  it('MISSING fails closed, STALE past RPO, OK within', () => {
    expect(backupFreshness(null, NOW)).toBe('MISSING');
    expect(backupFreshness(NOW - (RPO_TARGET_MS + 1), NOW)).toBe('STALE');
    expect(backupFreshness(NOW - 1000, NOW)).toBe('OK');
  });
});

describe('ITEM 39 — replay/recovery planner (no double-write, no loss)', () => {
  it('idle queue → NO_ACTION', () => {
    const p = planRecovery({ phase: 'QUEUE_IDLE', provider: 'meta' });
    expect(p.action).toBe('NO_ACTION');
    expect(p.dataLossRisk).toBe(false);
    expect(p.doubleWriteRisk).toBe(false);
  });

  it('in-flight read with a cursor → RESUME_FROM_CURSOR (no loss/double-write)', () => {
    const p = planRecovery({ phase: 'SYNC_READ_IN_FLIGHT', provider: 'google', resumeCursor: 'cur:7', paginationStop: 'MAX_PAGES' });
    expect(p.action).toBe('RESUME_FROM_CURSOR');
    expect(p.dataLossRisk).toBe(false);
    expect(p.doubleWriteRisk).toBe(false);
  });

  it('in-flight read with no cursor (not complete) → RESTART_READ', () => {
    const p = planRecovery({ phase: 'SYNC_READ_IN_FLIGHT', provider: 'google', resumeCursor: null, paginationStop: 'ABORTED' });
    expect(p.action).toBe('RESTART_READ');
    expect(p.dataLossRisk).toBe(false);
  });

  it('a completed read → NO_ACTION', () => {
    const p = planRecovery({ phase: 'SYNC_READ_IN_FLIGHT', provider: 'google', resumeCursor: null, paginationStop: 'COMPLETE' });
    expect(p.action).toBe('NO_ACTION');
  });

  it('write never claimed → NO_ACTION (nothing executed)', () => {
    const p = planRecovery({ phase: 'PROVIDER_WRITE_IN_FLIGHT', provider: 'meta', writeClaimed: false });
    expect(p.action).toBe('NO_ACTION');
    expect(p.doubleWriteRisk).toBe(false);
  });

  it('write claimed + acknowledged → NO_ACTION (already recorded)', () => {
    const p = planRecovery({ phase: 'PROVIDER_WRITE_IN_FLIGHT', provider: 'meta', writeClaimed: true, writeAcknowledged: true });
    expect(p.action).toBe('NO_ACTION');
  });

  it('claimed + unacknowledged WITH idempotency key → SAFE_RETRY_IDEMPOTENT (no double-write)', () => {
    const p = planRecovery({ phase: 'PROVIDER_WRITE_IN_FLIGHT', provider: 'google', writeClaimed: true, writeAcknowledged: false, providerSupportsIdempotencyKey: true });
    expect(p.action).toBe('SAFE_RETRY_IDEMPOTENT');
    expect(p.doubleWriteRisk).toBe(false);
  });

  it('claimed + unacknowledged WITHOUT idempotency key → RECONCILE_BEFORE_RETRY (never blind replay)', () => {
    const p = planRecovery({ phase: 'PROVIDER_WRITE_IN_FLIGHT', provider: 'meta', writeClaimed: true, writeAcknowledged: false, providerSupportsIdempotencyKey: false });
    expect(p.action).toBe('RECONCILE_BEFORE_RETRY');
    expect(p.doubleWriteRisk).toBe(true);
    expect(p.dataLossRisk).toBe(false);
  });

  it('reuses the connection-recovery table: an unresolved condition gates resumption', () => {
    const p = planRecovery({ phase: 'SYNC_READ_IN_FLIGHT', provider: 'google', resumeCursor: 'cur:3', connectionCondition: 'RATE_LIMIT' });
    expect(p.action).toBe('AWAIT_CONNECTION_RECOVERY');
    expect(p.connectionRecovery?.action).toBe('BACKOFF');
    expect(p.dataLossRisk).toBe(false);
  });

  it('a DISABLED connection forbids execution entirely', () => {
    const p = planRecovery({ phase: 'PROVIDER_WRITE_IN_FLIGHT', provider: 'meta', writeClaimed: true, connectionCondition: 'DISABLED' });
    expect(p.action).toBe('NO_EXECUTION');
    expect(p.connectionRecovery?.action).toBe('NO_EXECUTION');
  });
});

describe('ITEM 39 — backup/restore execution is BLOCKED_EXTERNAL (no autonomous action)', () => {
  it('executeBackupSnapshot throws, never runs', () => {
    expect(() => executeBackupSnapshot()).toThrow(DrExecutionBlockedError);
    try {
      executeBackupSnapshot();
    } catch (e) {
      expect((e as DrExecutionBlockedError).marker).toBe(DR_EXECUTION_BLOCKED_MARKER);
    }
  });

  it('executeRestore throws, never runs', () => {
    expect(() => executeRestore()).toThrow(DrExecutionBlockedError);
  });
});
