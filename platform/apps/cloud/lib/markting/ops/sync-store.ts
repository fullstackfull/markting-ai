import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { SyncJob, SyncType } from './sync-runner';
import { SYNC_TYPE_PRIORITY } from './sync-runner';
import type { SyncQueueStore } from './sync-worker';

/**
 * PHASE C.5 (1) — persistence for the sync queue. ONE queue: `public.markting_sync_jobs`. The Postgres
 * store performs the atomic lease (single-winner claim) in SQL; the in-memory store mirrors it for unit
 * tests. Enqueue is idempotent on (org, provider, idempotency_key) so a re-schedule never double-queues.
 */

export interface EnqueueInput {
  organizationId: string;
  provider: string;
  syncType: SyncType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  now: number;
}

function newJob(input: EnqueueInput): SyncJob {
  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    provider: input.provider,
    type: input.syncType,
    state: 'QUEUED',
    idempotencyKey: input.idempotencyKey,
    attempts: 0,
    notBeforeMs: 0,
    priority: SYNC_TYPE_PRIORITY[input.syncType],
    enqueuedAtMs: input.now,
  };
}

/** In-memory queue — deterministic, for unit tests (no DB). */
export class InMemorySyncQueue implements SyncQueueStore {
  private jobs = new Map<string, SyncJob>();
  private keys = new Map<string, string>(); // (org|provider|idemKey) -> job id

  async enqueue(input: EnqueueInput): Promise<SyncJob> {
    const k = `${input.organizationId}|${input.provider}|${input.idempotencyKey}`;
    const existingId = this.keys.get(k);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      // Idempotent: only a terminal job is re-opened as a fresh attempt; otherwise return as-is.
      if (existing.state === 'SUCCEEDED' || existing.state === 'DEAD_LETTER' || existing.state === 'CANCELLED') {
        const re = newJob(input); re.id = existing.id;
        this.jobs.set(re.id, re); return re;
      }
      return existing;
    }
    const job = newJob(input);
    this.jobs.set(job.id, job); this.keys.set(k, job.id);
    return job;
  }

  async loadDispatchable(now: number, limit: number): Promise<SyncJob[]> {
    return [...this.jobs.values()]
      .filter((j) => (j.state === 'QUEUED' || j.state === 'RETRY_WAIT') && j.notBeforeMs <= now)
      .slice(0, limit)
      .map((j) => ({ ...j }));
  }

  async loadInflight(): Promise<SyncJob[]> {
    return [...this.jobs.values()].filter((j) => j.state === 'LEASED').map((j) => ({ ...j }));
  }

  async claim(job: SyncJob, owner: string, now: number, leaseMs: number): Promise<SyncJob | null> {
    const cur = this.jobs.get(job.id);
    if (!cur) return null;
    const claimable = cur.state === 'QUEUED' || cur.state === 'RETRY_WAIT'
      || (cur.state === 'LEASED' && cur.leaseExpiresAtMs != null && cur.leaseExpiresAtMs <= now);
    if (!claimable || cur.notBeforeMs > now) return null;
    void owner;
    const leased: SyncJob = { ...cur, state: 'LEASED', leaseExpiresAtMs: now + leaseMs };
    this.jobs.set(job.id, leased);
    return { ...leased };
  }

  async save(job: SyncJob): Promise<void> { this.jobs.set(job.id, { ...job }); }

  // test helpers
  all(): SyncJob[] { return [...this.jobs.values()].map((j) => ({ ...j })); }
  get(id: string): SyncJob | undefined { const j = this.jobs.get(id); return j && { ...j }; }
}

type Row = {
  id: string; organization_id: string; provider: string; sync_type: SyncType; state: SyncJob['state'];
  idempotency_key: string; priority: number; attempts: number; not_before_ms: string | number;
  lease_expires_at_ms: string | number | null; enqueued_at_ms: string | number; last_error: string | null;
};
function rowToJob(r: Row): SyncJob {
  return {
    id: r.id, organizationId: r.organization_id, provider: r.provider, type: r.sync_type, state: r.state,
    idempotencyKey: r.idempotency_key, priority: r.priority, attempts: r.attempts,
    notBeforeMs: Number(r.not_before_ms), leaseExpiresAtMs: r.lease_expires_at_ms == null ? undefined : Number(r.lease_expires_at_ms),
    enqueuedAtMs: Number(r.enqueued_at_ms), lastError: r.last_error ?? undefined,
  };
}

/** Postgres-backed queue over markting_sync_jobs. Claim is a single atomic conditional UPDATE. */
export class PostgresSyncQueue implements SyncQueueStore {
  async enqueue(input: EnqueueInput): Promise<SyncJob> {
    const priority = SYNC_TYPE_PRIORITY[input.syncType];
    const rows = await db()<Row[]>`
      insert into public.markting_sync_jobs
        (organization_id, provider, sync_type, state, idempotency_key, priority, attempts, not_before_ms, enqueued_at_ms, payload)
      values (${input.organizationId}, ${input.provider}, ${input.syncType}, 'QUEUED', ${input.idempotencyKey},
              ${priority}, 0, 0, ${input.now}, ${JSON.stringify(input.payload ?? {})}::jsonb)
      on conflict (organization_id, provider, idempotency_key) do update
        set state = case when public.markting_sync_jobs.state in ('SUCCEEDED','DEAD_LETTER','CANCELLED')
                         then 'QUEUED' else public.markting_sync_jobs.state end,
            attempts = case when public.markting_sync_jobs.state in ('SUCCEEDED','DEAD_LETTER','CANCELLED')
                            then 0 else public.markting_sync_jobs.attempts end,
            updated_at = now()
      returning *
    `;
    return rowToJob(rows[0]!);
  }

  async loadDispatchable(now: number, limit: number): Promise<SyncJob[]> {
    const rows = await db()<Row[]>`
      select * from public.markting_sync_jobs
      where state in ('QUEUED','RETRY_WAIT') and not_before_ms <= ${now}
      order by priority asc, enqueued_at_ms asc
      limit ${limit}
    `;
    return rows.map(rowToJob);
  }

  async loadInflight(): Promise<SyncJob[]> {
    const rows = await db()<Row[]>`select * from public.markting_sync_jobs where state = 'LEASED'`;
    return rows.map(rowToJob);
  }

  async claim(job: SyncJob, owner: string, now: number, leaseMs: number): Promise<SyncJob | null> {
    const rows = await db()<Row[]>`
      update public.markting_sync_jobs
      set state = 'LEASED', lease_expires_at_ms = ${now + leaseMs}, lease_owner = ${owner}, updated_at = now()
      where id = ${job.id}
        and not_before_ms <= ${now}
        and (state in ('QUEUED','RETRY_WAIT') or (state = 'LEASED' and lease_expires_at_ms <= ${now}))
      returning *
    `;
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async save(job: SyncJob): Promise<void> {
    await db()`
      update public.markting_sync_jobs
      set state = ${job.state}, attempts = ${job.attempts}, not_before_ms = ${job.notBeforeMs},
          lease_expires_at_ms = ${job.leaseExpiresAtMs ?? null}, last_error = ${job.lastError ?? null},
          lease_owner = ${job.state === 'LEASED' ? job.id : null}, updated_at = now()
      where id = ${job.id}
    `;
  }
}
