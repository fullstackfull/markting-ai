import { describe, expect, it } from 'vitest';
import { buildChaosRig, SeededRandom, type ChaosRow, type FaultPlan } from '@/lib/markting/ops/chaos';
import {
  runProviderRead,
  type ExecutorBudget,
  type ExecutorGuards,
  type ExecutorResult,
} from '@/lib/markting/ops/provider-executor';
import { recommendRecovery, type RecoveryCondition } from '@/lib/markting/ops/connection-recovery';
import { evaluateWriteBlocked, type KillSwitch, type WriteContext } from '@/lib/markting/ops/kill-switch';
import { partitionForQuarantine } from '@/lib/markting/ops/quarantine';
import type { SyncJob } from '@/lib/markting/ops/sync-runner';

const JOB: SyncJob = {
  id: 'job_1',
  organizationId: 'org_1',
  provider: 'chaos',
  type: 'INCREMENTAL',
  state: 'LEASED',
  idempotencyKey: 'idem_1',
  attempts: 1,
  notBeforeMs: 0,
  priority: 1,
  enqueuedAtMs: 0,
};

const GUARDS: ExecutorGuards = { connectionActive: true, sourceModeAllows: true };

async function run(plan: FaultPlan, scenario: Partial<Parameters<typeof buildChaosRig>[0]> = {}): Promise<{ result: ExecutorResult; pages: number }> {
  const rig = buildChaosRig({ plan, limit: 10, rowsPerPage: 10, totalPages: 3, startTimeMs: 1000, seed: 42, ...scenario });
  const budget: ExecutorBudget = { maxPages: 50, maxRows: 10_000, timeoutMs: 60_000 };
  const result = await runProviderRead<ChaosRow>(JOB, rig.transport, budget, GUARDS, {}, { now: rig.now, isAborted: rig.isAborted });
  return { result, pages: rig.pagesFetched() };
}

describe('ITEM 41 — chaos harness is deterministic', () => {
  it('seeded PRNG replays identically', () => {
    const a = new SeededRandom(7);
    const b = new SeededRandom(7);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('a fault-free run reaches SUCCESS with an honest row count', async () => {
    const { result, pages } = await run({ perPage: [] });
    expect(result.status).toBe('SUCCESS');
    expect(result.errorClass).toBe('NONE');
    expect(result.rowsRead).toBe(30); // 3 pages * 10 rows
    expect(result.rowsAccepted).toBe(30);
    expect(pages).toBe(3);
  });
});

describe('ITEM 41 — provider signals degrade safely (never a false SUCCESS)', () => {
  const cases: Array<{ signal: 'AUTH' | 'RATE_LIMIT' | 'SCHEMA' | 'TRANSIENT' | 'PERMANENT'; status: ExecutorResult['status']; errorClass: ExecutorResult['errorClass']; retryable: boolean; condition: RecoveryCondition }> = [
    { signal: 'AUTH', status: 'REAUTH_REQUIRED', errorClass: 'AUTH', retryable: false, condition: 'AUTH_ERROR' },
    { signal: 'RATE_LIMIT', status: 'RATE_LIMITED', errorClass: 'RATE_LIMIT', retryable: true, condition: 'RATE_LIMIT' },
    { signal: 'SCHEMA', status: 'SCHEMA_CHANGED', errorClass: 'SCHEMA', retryable: false, condition: 'SCHEMA_CHANGED' },
    { signal: 'TRANSIENT', status: 'PROVIDER_ERROR', errorClass: 'TRANSIENT', retryable: true, condition: 'SYNC_FAILED' },
    { signal: 'PERMANENT', status: 'PROVIDER_ERROR', errorClass: 'PERMANENT', retryable: false, condition: 'SYNC_FAILED' },
  ];

  for (const c of cases) {
    it(`${c.signal} → ${c.status}, honest classification + mapped recovery`, async () => {
      const { result } = await run({ perPage: [{ kind: 'SIGNAL', signal: c.signal, retryAfterMs: c.signal === 'RATE_LIMIT' ? 2500 : undefined }] });
      expect(result.status).toBe(c.status);
      expect(result.status).not.toBe('SUCCESS');
      expect(result.errorClass).toBe(c.errorClass);
      expect(result.retryable).toBe(c.retryable);
      if (c.signal === 'RATE_LIMIT') expect(result.retryAfterMs).toBe(2500);
      // Recovery maps to the right action (reused table), not an ad-hoc guess.
      const rec = recommendRecovery(c.condition);
      if (c.signal === 'AUTH') expect(rec.action).toBe('REAUTHORIZE');
      if (c.signal === 'RATE_LIMIT') expect(rec.action).toBe('BACKOFF');
      if (c.signal === 'SCHEMA') expect(rec.action).toBe('QUARANTINE_AND_ALERT');
    });
  }
});

describe('ITEM 41 — in-band drift + reject rows', () => {
  it('SCHEMA rows force SCHEMA_CHANGED even when pagination completes', async () => {
    const { result } = await run({ perPage: [{ kind: 'SCHEMA_ROWS' }] }, { totalPages: 1 });
    expect(result.status).toBe('SCHEMA_CHANGED');
    expect(result.status).not.toBe('SUCCESS');
    expect(result.errorClass).toBe('SCHEMA');
    expect(result.retryable).toBe(false);
  });

  it('rejected rows are counted as rejected, run still honest', async () => {
    const { result } = await run({ perPage: [{ kind: 'REJECT_ROWS' }] }, { totalPages: 1 });
    expect(result.status).toBe('SUCCESS'); // pagination complete, no schema drift
    expect(result.rowsRejected).toBe(10);
    expect(result.rowsAccepted).toBe(0);
  });
});

describe('ITEM 41 — loop detection fires on a non-advancing cursor', () => {
  it('a repeated cursor → PARTIAL_SUCCESS / LOOP_DETECTED, non-retryable, never SUCCESS', async () => {
    const { result, pages } = await run({ perPage: [], tail: { kind: 'REPEATED_CURSOR', cursor: 'stuck' } }, { totalPages: 999 });
    expect(result.paginationStop).toBe('LOOP_DETECTED');
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.status).not.toBe('SUCCESS');
    expect(result.retryable).toBe(false);
    expect(result.errorClass).toBe('PERMANENT');
    // Loop protection bounds the work — it did not spin.
    expect(pages).toBeLessThanOrEqual(3);
  });
});

describe('ITEM 41 — truncated pages stay honest', () => {
  it('a truncated final page yields SUCCESS with the true (smaller) count', async () => {
    const { result } = await run({ perPage: [{ kind: 'TRUNCATED_PAGE', rows: 2 }] }, { totalPages: 1 });
    expect(result.status).toBe('SUCCESS');
    expect(result.rowsRead).toBe(2);
  });
});

describe('ITEM 41 — abort + clock jump (deterministic time)', () => {
  it('a scripted abort → UNKNOWN/AMBIGUOUS with a resumable cursor (never SUCCESS)', async () => {
    const { result } = await run({ perPage: [], abortFromPage: 1 }, { totalPages: 5 });
    expect(result.status).toBe('UNKNOWN');
    expect(result.status).not.toBe('SUCCESS');
    expect(result.errorClass).toBe('AMBIGUOUS');
    expect(result.retryable).toBe(true);
    expect(result.resumeCursor).not.toBeNull();
  });

  it('a clock jump past the deadline → PARTIAL_SUCCESS/TIMEOUT, resumable', async () => {
    const plan: FaultPlan = { perPage: [], clockJumpsMs: [120_000] };
    const { result } = await run(plan, { totalPages: 5 });
    expect(result.paginationStop).toBe('DEADLINE');
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.errorClass).toBe('TIMEOUT');
    expect(result.retryable).toBe(true);
    expect(result.resumeCursor).not.toBeNull();
  });
});

describe('ITEM 41 — kill-switch + quarantine engage under chaos', () => {
  it('after a PERMANENT provider fault, a kill switch blocks further writes', async () => {
    const { result } = await run({ perPage: [{ kind: 'SIGNAL', signal: 'PERMANENT' }] });
    expect(result.status).toBe('PROVIDER_ERROR');
    // Operator engages a provider-scope kill switch in response — writes now fail closed.
    const active: KillSwitch[] = [{ scope: 'PROVIDER', key: 'chaos', active: true, reason: 'repeated_permanent_fault' }];
    const ctx: WriteContext = { organizationId: 'org_1', provider: 'chaos', accountId: 'acct_1', actionType: 'SET_DAILY_BUDGET' };
    const decision = evaluateWriteBlocked(ctx, active);
    expect(decision.blocked).toBe(true);
    if (decision.blocked) expect(decision.by).toBe('PROVIDER');
  });

  it('schema-drift / malformed rows are quarantined, never admitted', async () => {
    const batch = [
      { organizationId: 'org_1', spend: 10, impressions: 100, clicks: 5 }, // good
      { organizationId: 'org_1', spend: -5 }, // IMPOSSIBLE_VALUE
      null, // MALFORMED_ROW
    ];
    const { accepted, quarantined } = partitionForQuarantine(batch, { provider: 'chaos' });
    expect(accepted).toHaveLength(1);
    expect(quarantined).toHaveLength(2);
    // The invariant: nothing quarantined is in accepted.
    expect(accepted.some((r) => r === null)).toBe(false);
  });
});

describe('ITEM 41 — FAILS HONEST across every scripted fault', () => {
  it('no fault ever produces a false SUCCESS', async () => {
    const faultyPlans: FaultPlan[] = [
      { perPage: [{ kind: 'SIGNAL', signal: 'AUTH' }] },
      { perPage: [{ kind: 'SIGNAL', signal: 'RATE_LIMIT' }] },
      { perPage: [{ kind: 'SIGNAL', signal: 'SCHEMA' }] },
      { perPage: [{ kind: 'SIGNAL', signal: 'TRANSIENT' }] },
      { perPage: [{ kind: 'SIGNAL', signal: 'PERMANENT' }] },
      { perPage: [{ kind: 'SCHEMA_ROWS' }] },
      { perPage: [], tail: { kind: 'REPEATED_CURSOR', cursor: 'x' } },
      { perPage: [], abortFromPage: 1 },
      { perPage: [], clockJumpsMs: [120_000] },
    ];
    for (const plan of faultyPlans) {
      const { result } = await run(plan, { totalPages: 5 });
      expect(result.status).not.toBe('SUCCESS');
    }
  });
});
