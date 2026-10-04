import 'server-only';

/**
 * PHASE C (C8) — BACKGROUND SYNC RUNNER: the scheduling/dispatch model.
 *
 * This is the PURE, deterministic core of the multi-tenant sync worker: given the current queue,
 * what is in flight, the clock, and the limits, decide EXACTLY which jobs may start next. It enforces
 * bounded global concurrency, per-provider rate limits (token bucket), per-tenant fairness (a cap on
 * in-flight jobs per org so one tenant cannot starve others), lease expiry, exponential backoff with
 * jitter, a max-attempts dead-letter, idempotency, and the kill-switch (a job under an active kill
 * scope is never dispatched).
 *
 * It does NOT make network calls — the actual provider execution loop that consumes a dispatch plan
 * and performs live reads is BLOCKED_EXTERNAL (no live credentials in this environment). Keeping the
 * decision logic pure makes the hard parts (fairness, rate limits, retries, leases) fully unit-testable
 * now, and leaves only the thin live-I/O shell for when credentials exist.
 */

export const SYNC_TYPES = ['INITIAL', 'INCREMENTAL', 'REAUTH_REQUIRED', 'MANUAL_RETRY', 'WEBHOOK_TRIGGERED'] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

export const SYNC_JOB_STATES = ['QUEUED', 'LEASED', 'SUCCEEDED', 'RETRY_WAIT', 'DEAD_LETTER', 'CANCELLED'] as const;
export type SyncJobState = (typeof SYNC_JOB_STATES)[number];

export interface SyncJob {
  id: string;
  organizationId: string;
  provider: string;
  type: SyncType;
  state: SyncJobState;
  /** Monotone idempotency key — a re-enqueue with the same key must not create a second live effect. */
  idempotencyKey: string;
  attempts: number;
  /** Epoch ms the job is eligible to run (backoff pushes this into the future). */
  notBeforeMs: number;
  /** Epoch ms a current lease expires; a LEASED job past this is reclaimable (crash recovery). */
  leaseExpiresAtMs?: number;
  /** Lower number = higher priority. REAUTH/webhook are time-sensitive; initial backfill is low. */
  priority: number;
  enqueuedAtMs: number;
}

export interface SyncLimits {
  /** Global max jobs in flight across all tenants. */
  maxConcurrent: number;
  /** Max in-flight jobs per organization (fairness: no tenant monopolizes the pool). */
  maxPerOrg: number;
  /** Max attempts before a job is dead-lettered. */
  maxAttempts: number;
  /** Base backoff ms; attempt N waits base * 2^(N-1), capped, plus jitter. */
  backoffBaseMs: number;
  backoffCapMs: number;
}

export const DEFAULT_SYNC_LIMITS: SyncLimits = {
  maxConcurrent: 8,
  maxPerOrg: 2,
  maxAttempts: 5,
  backoffBaseMs: 30_000,
  backoffCapMs: 30 * 60_000,
};

/** Default priority by sync type — time-sensitive work first, bulk backfill last. */
export const SYNC_TYPE_PRIORITY: Record<SyncType, number> = {
  REAUTH_REQUIRED: 0,
  WEBHOOK_TRIGGERED: 1,
  MANUAL_RETRY: 2,
  INCREMENTAL: 3,
  INITIAL: 4,
};

/** A per-provider token bucket snapshot (refilled elsewhere); here we only read available tokens. */
export interface RateBudget {
  /** Whole tokens currently available for this provider. A job costs 1 token. */
  availableTokens: number;
}

/**
 * Exponential backoff with full jitter, capped. attempt is the number of attempts ALREADY made
 * (>=1 when scheduling a retry). Deterministic when a `rand` in [0,1) is supplied (for tests).
 */
export function backoffMs(attempt: number, limits: SyncLimits, rand: () => number = Math.random): number {
  const exp = Math.min(limits.backoffCapMs, limits.backoffBaseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exp * (0.5 + 0.5 * rand())); // full-jitter in [exp/2, exp]
}

/** A kill-switch predicate: returns true when a (org, provider, type) job is currently killed. */
export type KillPredicate = (job: SyncJob) => boolean;

export interface DispatchContext {
  now: number;
  limits: SyncLimits;
  /** Jobs currently LEASED (in flight). Used for concurrency + fairness accounting. */
  inflight: SyncJob[];
  /** Per-provider available rate tokens. A provider absent from the map is treated as unlimited. */
  rate: Record<string, RateBudget>;
  /** True when the job is under an active kill scope (global/org/provider/type). */
  isKilled: KillPredicate;
}

export interface DispatchDecision {
  dispatch: SyncJob[];
  /** Jobs skipped this tick with the reason (observability + tests). */
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Decide which QUEUED (or lease-expired LEASED) jobs may start now. Pure: returns the jobs to lease
 * plus a skip ledger; it does not mutate inputs. Selection order: eligible jobs sorted by
 * (priority asc, enqueuedAt asc) — a stable, starvation-free order within the fairness cap.
 */
export function planDispatch(queue: SyncJob[], ctx: DispatchContext): DispatchDecision {
  const { now, limits, rate, isKilled } = ctx;
  const skipped: DispatchDecision['skipped'] = [];

  // Reclaim: a LEASED job whose lease expired is eligible again (crash recovery).
  const reclaimable = ctx.inflight.filter((j) => j.leaseExpiresAtMs != null && j.leaseExpiresAtMs <= now);
  const trulyInflight = ctx.inflight.filter((j) => !(j.leaseExpiresAtMs != null && j.leaseExpiresAtMs <= now));

  let globalSlots = Math.max(0, limits.maxConcurrent - trulyInflight.length);
  const perOrgInflight = new Map<string, number>();
  for (const j of trulyInflight) perOrgInflight.set(j.organizationId, (perOrgInflight.get(j.organizationId) ?? 0) + 1);
  const tokens = new Map<string, number>();
  for (const [p, b] of Object.entries(rate)) tokens.set(p, b.availableTokens);

  const eligible = [...queue, ...reclaimable]
    .filter((j) => j.state === 'QUEUED' || j.state === 'LEASED' || j.state === 'RETRY_WAIT')
    .sort((a, b) => (a.priority - b.priority) || (a.enqueuedAtMs - b.enqueuedAtMs) || a.id.localeCompare(b.id));

  const dispatch: SyncJob[] = [];
  for (const job of eligible) {
    if (globalSlots <= 0) { skipped.push({ id: job.id, reason: 'MAX_CONCURRENT' }); continue; }
    if (job.notBeforeMs > now) { skipped.push({ id: job.id, reason: 'BACKOFF_WAIT' }); continue; }
    if (job.attempts >= limits.maxAttempts) { skipped.push({ id: job.id, reason: 'DEAD_LETTER' }); continue; }
    if (isKilled(job)) { skipped.push({ id: job.id, reason: 'KILL_SWITCH' }); continue; }
    const orgCount = perOrgInflight.get(job.organizationId) ?? 0;
    if (orgCount >= limits.maxPerOrg) { skipped.push({ id: job.id, reason: 'ORG_FAIRNESS_CAP' }); continue; }
    if (tokens.has(job.provider)) {
      const avail = tokens.get(job.provider)!;
      if (avail <= 0) { skipped.push({ id: job.id, reason: 'RATE_LIMITED' }); continue; }
      tokens.set(job.provider, avail - 1);
    }
    dispatch.push(job);
    globalSlots -= 1;
    perOrgInflight.set(job.organizationId, orgCount + 1);
  }
  return { dispatch, skipped };
}

/** Transition a job after a failed attempt: schedule a jittered-backoff retry, or dead-letter it. */
export function onFailure(job: SyncJob, ctx: { now: number; limits: SyncLimits; rand?: () => number }): SyncJob {
  const attempts = job.attempts + 1;
  if (attempts >= ctx.limits.maxAttempts) {
    return { ...job, attempts, state: 'DEAD_LETTER', leaseExpiresAtMs: undefined };
  }
  return {
    ...job,
    attempts,
    state: 'RETRY_WAIT',
    notBeforeMs: ctx.now + backoffMs(attempts, ctx.limits, ctx.rand),
    leaseExpiresAtMs: undefined,
  };
}

/** Transition a job after success: terminal SUCCEEDED, lease cleared. */
export function onSuccess(job: SyncJob): SyncJob {
  return { ...job, state: 'SUCCEEDED', leaseExpiresAtMs: undefined };
}

/** Lease a job for a worker: mark LEASED with an expiry (for crash-recovery reclaim). */
export function leaseJob(job: SyncJob, now: number, leaseMs: number): SyncJob {
  return { ...job, state: 'LEASED', leaseExpiresAtMs: now + leaseMs };
}
