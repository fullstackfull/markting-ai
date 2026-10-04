import 'server-only';
import { paginate, type PageSource, type PaginateLimits, type PaginateStop } from './provider-pagination';
import type { SyncJob } from './sync-runner';
import type { ExecOutcome } from './sync-worker';

/**
 * PHASE C.6 (1,2,4) — PROVIDER EXECUTOR SHELL + canonical result contract.
 *
 * The provider-specific I/O shell the sync worker drives. It does NO real network I/O here: a
 * `ProviderTransport` port is injected (a fake/contract transport in tests; a real HTTP client only when
 * credentials exist — BLOCKED_EXTERNAL). The shell owns everything AROUND the provider call: request
 * budgeting, bounded paginated iteration, cancellation/timeout, rate-limit propagation, retry
 * classification, schema-drift hand-off, the connection-disabled + source-mode guards, and observability
 * hooks — producing a typed `ExecutorResult` with no raw secrets.
 */

export type ExecutorStatus =
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'REAUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'SCHEMA_CHANGED'
  | 'UNKNOWN';

export type ErrorClass =
  | 'NONE' | 'AUTH' | 'RATE_LIMIT' | 'SCHEMA' | 'TRANSIENT' | 'PERMANENT' | 'TIMEOUT' | 'AMBIGUOUS';

export interface ExecutorResult {
  status: ExecutorStatus;
  provider: string;
  organizationId: string;
  connectionId: string | null;
  accountId: string | null;
  startedAt: string;
  completedAt: string;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  /** Whether a RETRY is appropriate for this result (never for AUTH/SCHEMA/PERMANENT). */
  retryable: boolean;
  errorClass: ErrorClass;
  /** Terse, secret-free diagnostic (never a token or raw payload). */
  evidence?: string;
  /** For RATE_LIMITED: the provider-advised wait, propagated to the scheduler. */
  retryAfterMs?: number;
  /** For PARTIAL_SUCCESS: a resumable cursor so the next run continues, not restarts. */
  resumeCursor?: string | null;
  paginationStop?: PaginateStop;
}

/** A raised provider condition the transport can throw to steer classification (no secrets inside). */
export class ProviderSignal extends Error {
  constructor(public readonly kind: 'AUTH' | 'RATE_LIMIT' | 'SCHEMA' | 'TRANSIENT' | 'PERMANENT', message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderSignal';
  }
}

/** The injected transport: reads pages + validates rows. Fake in tests; BLOCKED_EXTERNAL for real HTTP. */
export interface ProviderTransport<Row> {
  readonly provider: string;
  pageSource(job: SyncJob): PageSource<Row>;
  /** Validate/normalize one row. Return null to REJECT (quarantine), 'SCHEMA' to flag drift. */
  classifyRow(row: Row): 'ACCEPT' | 'REJECT' | 'SCHEMA';
}

export interface ExecutorBudget extends PaginateLimits {
  /** Per-run wall-clock budget in ms (enforced as the pagination deadline + the timeout race). */
  timeoutMs: number;
}

export const DEFAULT_EXECUTOR_BUDGET: ExecutorBudget = { maxPages: 50, maxRows: 10_000, timeoutMs: 60_000 };

export interface ExecutorGuards {
  connectionActive: boolean;
  sourceModeAllows: boolean;
}

export interface ExecutorObserver {
  onPage?: (info: { page: number; rows: number }) => void;
  onResult?: (result: ExecutorResult) => void;
}

function nowIso(): string { return new Date().toISOString(); }

/**
 * Run one provider read for a job through the full shell. Pure over the injected transport + guards +
 * clock; never performs real network I/O itself.
 */
export async function runProviderRead<Row>(
  job: SyncJob,
  transport: ProviderTransport<Row>,
  budget: ExecutorBudget,
  guards: ExecutorGuards,
  observer: ExecutorObserver = {},
  opts: { now?: () => number; isAborted?: () => boolean } = {},
): Promise<ExecutorResult> {
  const startedAt = nowIso();
  const now = opts.now ?? Date.now;
  const base = {
    provider: transport.provider, organizationId: job.organizationId, connectionId: null as string | null,
    accountId: null as string | null,
  };
  const done = (r: Omit<ExecutorResult, 'provider' | 'organizationId' | 'connectionId' | 'accountId' | 'startedAt' | 'completedAt'>): ExecutorResult => {
    const result: ExecutorResult = { ...base, ...r, startedAt, completedAt: nowIso() };
    observer.onResult?.(result);
    return result;
  };

  // Guards first — never execute under a disabled connection or a disallowed source mode.
  if (!guards.sourceModeAllows) return done({ status: 'PROVIDER_ERROR', rowsRead: 0, rowsAccepted: 0, rowsRejected: 0, retryable: false, errorClass: 'PERMANENT', evidence: 'source_mode_disallows_live_read' });
  if (!guards.connectionActive) return done({ status: 'REAUTH_REQUIRED', rowsRead: 0, rowsAccepted: 0, rowsRejected: 0, retryable: false, errorClass: 'AUTH', evidence: 'connection_disabled_or_revoked' });

  const deadlineMs = now() + budget.timeoutMs;
  let rowsAccepted = 0, rowsRejected = 0, schemaSeen = false;

  try {
    const page = await paginate<Row>(
      transport.pageSource(job),
      { maxPages: budget.maxPages, maxRows: budget.maxRows, deadlineMs },
      { now, isAborted: opts.isAborted, onPage: (i) => observer.onPage?.({ page: i.page, rows: i.rows }) },
    );
    for (const row of page.rows) {
      const c = transport.classifyRow(row);
      if (c === 'ACCEPT') rowsAccepted += 1;
      else if (c === 'SCHEMA') { schemaSeen = true; rowsRejected += 1; }
      else rowsRejected += 1;
    }
    const rowsRead = page.rows.length;

    if (schemaSeen) {
      // Schema drift takes precedence — hand off to the quarantine/alert path, do not trust the run.
      return done({ status: 'SCHEMA_CHANGED', rowsRead, rowsAccepted, rowsRejected, retryable: false, errorClass: 'SCHEMA', evidence: 'provider_schema_changed', paginationStop: page.stop, resumeCursor: page.resumeCursor });
    }
    if (page.stop === 'COMPLETE') {
      return done({ status: 'SUCCESS', rowsRead, rowsAccepted, rowsRejected, retryable: false, errorClass: 'NONE', paginationStop: page.stop, resumeCursor: null });
    }
    if (page.stop === 'ABORTED') {
      return done({ status: 'UNKNOWN', rowsRead, rowsAccepted, rowsRejected, retryable: true, errorClass: 'AMBIGUOUS', evidence: 'aborted', paginationStop: page.stop, resumeCursor: page.resumeCursor });
    }
    if (page.stop === 'DEADLINE') {
      return done({ status: 'PARTIAL_SUCCESS', rowsRead, rowsAccepted, rowsRejected, retryable: true, errorClass: 'TIMEOUT', evidence: 'deadline', paginationStop: page.stop, resumeCursor: page.resumeCursor });
    }
    // MAX_PAGES / MAX_ROWS / LOOP_DETECTED → bounded partial; resumable.
    return done({ status: 'PARTIAL_SUCCESS', rowsRead, rowsAccepted, rowsRejected, retryable: page.stop !== 'LOOP_DETECTED', errorClass: page.stop === 'LOOP_DETECTED' ? 'PERMANENT' : 'TRANSIENT', evidence: page.stop.toLowerCase(), paginationStop: page.stop, resumeCursor: page.resumeCursor });
  } catch (e) {
    return done(classifyThrow(e, { rowsAccepted, rowsRejected }));
  }
}

/** Map a thrown transport error to the canonical result (retry classification). No secrets echoed. */
function classifyThrow(e: unknown, counts: { rowsAccepted: number; rowsRejected: number }): Omit<ExecutorResult, 'provider' | 'organizationId' | 'connectionId' | 'accountId' | 'startedAt' | 'completedAt'> {
  const common = { rowsRead: counts.rowsAccepted + counts.rowsRejected, rowsAccepted: counts.rowsAccepted, rowsRejected: counts.rowsRejected };
  if (e instanceof ProviderSignal) {
    switch (e.kind) {
      case 'AUTH': return { ...common, status: 'REAUTH_REQUIRED', retryable: false, errorClass: 'AUTH', evidence: 'auth_error' };
      case 'RATE_LIMIT': return { ...common, status: 'RATE_LIMITED', retryable: true, errorClass: 'RATE_LIMIT', evidence: 'rate_limited', retryAfterMs: e.retryAfterMs };
      case 'SCHEMA': return { ...common, status: 'SCHEMA_CHANGED', retryable: false, errorClass: 'SCHEMA', evidence: 'provider_schema_changed' };
      case 'TRANSIENT': return { ...common, status: 'PROVIDER_ERROR', retryable: true, errorClass: 'TRANSIENT', evidence: 'transient_error' };
      case 'PERMANENT': return { ...common, status: 'PROVIDER_ERROR', retryable: false, errorClass: 'PERMANENT', evidence: 'permanent_error' };
    }
  }
  // An unclassified throw is AMBIGUOUS — never blind-retried as success; the worker parks it.
  return { ...common, status: 'UNKNOWN', retryable: true, errorClass: 'AMBIGUOUS', evidence: 'unclassified_error' };
}

/** Bridge the canonical ExecutorResult to the worker's ExecOutcome (OK / ERROR / UNKNOWN). */
export function toExecOutcome(result: ExecutorResult): ExecOutcome {
  if (result.status === 'SUCCESS') return { status: 'OK' };
  if (result.status === 'UNKNOWN') return { status: 'UNKNOWN', error: result.evidence ?? 'unknown' };
  if (result.status === 'PARTIAL_SUCCESS') return result.retryable ? { status: 'ERROR', error: result.evidence ?? 'partial' } : { status: 'OK' };
  return { status: 'ERROR', error: `${result.status}:${result.errorClass}` };
}

// ---- provider executor registry ----
const REGISTRY = new Map<string, ProviderTransport<unknown>>();
export function registerProviderTransport<Row>(t: ProviderTransport<Row>): void { REGISTRY.set(t.provider, t as ProviderTransport<unknown>); }
export function resolveProviderTransport(provider: string): ProviderTransport<unknown> | undefined { return REGISTRY.get(provider); }
export function registeredProviders(): string[] { return [...REGISTRY.keys()]; }
export function resetProviderRegistryForTests(): void { REGISTRY.clear(); }
