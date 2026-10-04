import 'server-only';
import {
  planDispatch, onFailure, onSuccess, leaseJob,
  type SyncJob, type SyncLimits, type RateBudget, DEFAULT_SYNC_LIMITS,
} from './sync-runner';

/**
 * PHASE C.5 (1) — the SYNC WORKER EXECUTION RUNTIME.
 *
 * The runtime that drives the pure C8 dispatch core (`sync-runner.ts`). It loads the queue + in-flight
 * set from a store, asks `planDispatch` what may run, atomically leases each chosen job, runs it through
 * a GUARDED executor, and records success / retry / dead-letter back to the store. There is exactly one
 * queue (the `SyncQueueStore` port over `public.markting_sync_jobs`) — no second queue implementation.
 *
 * The actual live provider read executor is BLOCKED_EXTERNAL (no credentials). The runtime takes a
 * `SyncExecutor` port so the loop, lease/claim, reclaim, retry/backoff/dead-letter, fairness, rate
 * limiting, kill-switch awareness, logging and metrics are all fully exercisable with a sandbox/no-op
 * executor now, leaving only the thin live-I/O executor for when credentials exist. Sync reads are
 * READ-ONLY — the worker never performs a provider write (Mode B is HELD).
 */

export type ExecOutcome =
  | { status: 'OK' }
  | { status: 'ERROR'; error: string }
  | { status: 'UNKNOWN'; error: string }; // ambiguous result — reconciled, never blind-replayed

export interface SyncExecutor {
  /** Perform one job's work. MUST be read-only for sync. Receives the server-trusted job (org/provider). */
  execute(job: SyncJob): Promise<ExecOutcome>;
}

/** The single durable queue port (Postgres impl over markting_sync_jobs; in-memory impl for tests). */
export interface SyncQueueStore {
  /** QUEUED/RETRY_WAIT jobs eligible to consider this tick (store may pre-filter by notBefore/state). */
  loadDispatchable(now: number, limit: number): Promise<SyncJob[]>;
  /** Currently LEASED jobs (for concurrency/fairness accounting + reclaim). */
  loadInflight(): Promise<SyncJob[]>;
  /** Atomically move QUEUED/RETRY_WAIT/expired-LEASED → LEASED for this owner. Returns the job iff won. */
  claim(job: SyncJob, owner: string, now: number, leaseMs: number): Promise<SyncJob | null>;
  /** Persist a terminal/next state for a job (SUCCEEDED / RETRY_WAIT / DEAD_LETTER / CANCELLED). */
  save(job: SyncJob): Promise<void>;
}

/** Safety context the guarded executor checks BEFORE running any job. */
export interface SyncSafetyPorts {
  /** Is a kill scope active for this job (global/org/provider/type)? */
  isKilled(job: SyncJob): Promise<boolean> | boolean;
  /** Is the connection for this (org, provider) currently connected (not disabled/revoked)? */
  isConnectionActive(job: SyncJob): Promise<boolean> | boolean;
  /** Does the current runtime source mode permit this executor to run against live providers? */
  sourceModeAllows(job: SyncJob): Promise<boolean> | boolean;
  /** Does the provider capability registry support this sync at all? */
  providerSupportsSync(job: SyncJob): Promise<boolean> | boolean;
}

export type GuardReason = 'KILL_SWITCH' | 'CONNECTION_DISABLED' | 'SOURCE_MODE' | 'PROVIDER_UNSUPPORTED';

export interface WorkerLogger { info(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void }
export interface WorkerMetrics { inc(name: string, data?: Record<string, unknown>): void; observe(name: string, value: number, data?: Record<string, unknown>): void }

const NOOP_LOG: WorkerLogger = { info: () => {}, error: () => {} };
const NOOP_METRICS: WorkerMetrics = { inc: () => {}, observe: () => {} };

/**
 * Guard a single job before execution. Returns the blocking reason, or null when safe to run. This is
 * the enforcement of the worker-safety invariants: a job is NEVER executed under a kill switch, a
 * disabled connection, a disallowed source mode, or for an unsupported provider.
 */
export async function guardJob(job: SyncJob, ports: SyncSafetyPorts): Promise<GuardReason | null> {
  if (await ports.isKilled(job)) return 'KILL_SWITCH';
  if (!(await ports.providerSupportsSync(job))) return 'PROVIDER_UNSUPPORTED';
  if (!(await ports.sourceModeAllows(job))) return 'SOURCE_MODE';
  if (!(await ports.isConnectionActive(job))) return 'CONNECTION_DISABLED';
  return null;
}

export interface TickContext {
  now: number;
  owner: string;
  limits: SyncLimits;
  rate: Record<string, RateBudget>;
  leaseMs: number;
  store: SyncQueueStore;
  safety: SyncSafetyPorts;
  executor: SyncExecutor;
  log?: WorkerLogger;
  metrics?: WorkerMetrics;
  /** Deterministic RNG for backoff jitter in tests. */
  rand?: () => number;
}

export interface TickResult {
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  guarded: Array<{ id: string; reason: GuardReason }>;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Run one scheduling tick: plan → claim → guard → execute → record. Pure w.r.t. its ports (all effects
 * go through the store/executor/safety ports), so it is unit-testable with in-memory implementations.
 */
export async function runSyncTick(ctx: TickContext): Promise<TickResult> {
  const log = ctx.log ?? NOOP_LOG;
  const metrics = ctx.metrics ?? NOOP_METRICS;
  const res: TickResult = { claimed: 0, succeeded: 0, retried: 0, deadLettered: 0, guarded: [], skipped: [] };

  const [queue, inflight] = await Promise.all([
    ctx.store.loadDispatchable(ctx.now, ctx.limits.maxConcurrent * 4),
    ctx.store.loadInflight(),
  ]);

  const plan = planDispatch(queue, {
    now: ctx.now, limits: ctx.limits, inflight, rate: ctx.rate,
    // planDispatch's kill predicate is synchronous + best-effort; the authoritative async kill check is
    // re-run in guardJob below (defense in depth), so a stale sync predicate can never run a killed job.
    isKilled: () => false,
  });
  res.skipped = plan.skipped;
  metrics.observe('sync_queue_depth', queue.length);

  for (const planned of plan.dispatch) {
    const claimed = await ctx.store.claim(planned, ctx.owner, ctx.now, ctx.leaseMs);
    if (!claimed) { res.skipped.push({ id: planned.id, reason: 'CLAIM_LOST' }); continue; }
    res.claimed += 1;

    const blocked = await guardJob(claimed, ctx.safety);
    if (blocked) {
      res.guarded.push({ id: claimed.id, reason: blocked });
      metrics.inc('sync_guarded', { reason: blocked });
      log.info('sync job blocked by safety guard', { id: claimed.id, reason: blocked });
      // Return the job to the queue (not a failure): clear the lease, leave attempts untouched.
      await ctx.store.save({ ...claimed, state: 'QUEUED', leaseExpiresAtMs: undefined, lastAttemptBlocked: blocked } as SyncJob);
      continue;
    }

    const started = ctx.now;
    let outcome: ExecOutcome;
    try {
      outcome = await ctx.executor.execute(claimed);
    } catch (e) {
      outcome = { status: 'ERROR', error: e instanceof Error ? e.message : String(e) };
    }
    metrics.observe('sync_duration_ms', Date.now() - started, { provider: claimed.provider });

    if (outcome.status === 'OK') {
      await ctx.store.save(onSuccess(claimed));
      res.succeeded += 1;
      metrics.inc('sync_success', { provider: claimed.provider });
    } else if (outcome.status === 'UNKNOWN') {
      // Ambiguous result: do NOT blind-retry. Park in RETRY_WAIT with the error recorded; the write-path
      // reconciler (ops/idempotency.ts) owns resolution. For read-only sync this is effectively a retry.
      const next = onFailure({ ...claimed, lastError: outcome.error } as SyncJob, { now: ctx.now, limits: ctx.limits, rand: ctx.rand });
      await ctx.store.save(next);
      if (next.state === 'DEAD_LETTER') res.deadLettered += 1; else res.retried += 1;
      metrics.inc('sync_unknown_result', { provider: claimed.provider });
    } else {
      const next = onFailure({ ...claimed, lastError: outcome.error } as SyncJob, { now: ctx.now, limits: ctx.limits, rand: ctx.rand });
      await ctx.store.save(next);
      if (next.state === 'DEAD_LETTER') { res.deadLettered += 1; metrics.inc('sync_dead_letter', { provider: claimed.provider }); }
      else { res.retried += 1; metrics.inc('sync_failure', { provider: claimed.provider }); }
    }
  }
  return res;
}

/**
 * The long-running worker: a safe start/stop wrapper that runs `runSyncTick` on an interval. Startup is
 * idempotent; shutdown is graceful (stops scheduling new ticks and waits for the in-flight tick). It
 * never overlaps ticks (a single-flight guard), so concurrency is governed solely by the limits.
 */
export class SyncWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private ticking = false;
  private stopped: Promise<void> = Promise.resolve();
  private resolveStopped: () => void = () => {};

  constructor(private readonly makeCtx: () => TickContext, private readonly intervalMs = 5_000) {}

  start(): void {
    if (this.running) return; // idempotent
    this.running = true;
    this.stopped = new Promise((r) => { this.resolveStopped = r; });
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tickOnce(), delay);
  }

  private async tickOnce(): Promise<void> {
    if (this.ticking) { this.schedule(this.intervalMs); return; }
    this.ticking = true;
    const ctx = this.makeCtx();
    try {
      await runSyncTick(ctx);
    } catch (e) {
      (ctx.log ?? NOOP_LOG).error('sync tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.ticking = false;
      if (this.running) this.schedule(this.intervalMs);
      else this.resolveStopped();
    }
  }

  /** Graceful shutdown: stop scheduling and resolve once any in-flight tick has drained. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.ticking) this.resolveStopped();
    await this.stopped;
  }

  get isRunning(): boolean { return this.running; }
}
