import 'server-only';
import { ProviderSignal, type ProviderTransport } from './provider-executor';
import type { PageRequest, PageResult, PageSource } from './provider-pagination';
import type { SyncJob } from './sync-runner';

/**
 * PHASE C.6 (41) — CHAOS FAULT-INJECTION HARNESS (deterministic, in-process, no network).
 *
 * A scripted fault injector wrapping a fake transport/clock so the executor + pagination can be driven
 * through adversarial conditions with NO external services. Faults are SCRIPTED per page (plus a seeded
 * PRNG for row identity) so every run is reproducible: provider signals (AUTH/RATE_LIMIT/SCHEMA/
 * TRANSIENT/PERMANENT), truncated pages, repeated cursors, drift/reject rows, scripted clock jumps, and
 * aborts. The point is to prove the system DEGRADES SAFELY and FAILS HONEST — never a false SUCCESS.
 */

// ---- deterministic seeded PRNG (mulberry32) ----
export class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Next float in [0,1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ---- controllable clock (injected; scripted jumps) ----
export class ChaosClock {
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

// ---- faults ----
export type FaultSignalKind = 'AUTH' | 'RATE_LIMIT' | 'SCHEMA' | 'TRANSIENT' | 'PERMANENT';

export type Fault =
  | { kind: 'NONE' }
  /** Throw a ProviderSignal from fetchPage (executor must classify it, never SUCCESS). */
  | { kind: 'SIGNAL'; signal: FaultSignalKind; retryAfterMs?: number; message?: string }
  /** Emit only `rows` rows this page (partial read) while still advancing normally. */
  | { kind: 'TRUNCATED_PAGE'; rows: number }
  /** Echo a fixed non-advancing cursor so pagination loop-protection fires. */
  | { kind: 'REPEATED_CURSOR'; cursor: string }
  /** Emit rows the classifier flags as SCHEMA drift (in-band). */
  | { kind: 'SCHEMA_ROWS' }
  /** Emit rows the classifier REJECTS (quarantine candidates). */
  | { kind: 'REJECT_ROWS' };

export interface FaultPlan {
  /** Fault applied on page N (1-based): perPage[0] → page 1. Beyond the array, `tail` applies. */
  perPage: Fault[];
  /** Fault for pages past `perPage` (defaults to NONE). */
  tail?: Fault;
  /** Clock jump (ms) to apply AFTER fetching page N (1-based): clockJumpsMs[0] → after page 1. */
  clockJumpsMs?: number[];
  /** From this page (1-based) onward, isAborted() returns true (checked at the next loop top). */
  abortFromPage?: number;
}

function faultForPage(plan: FaultPlan, page1: number): Fault {
  const f = plan.perPage[page1 - 1];
  if (f) return f;
  return plan.tail ?? { kind: 'NONE' };
}

// ---- chaos row + its classifier ----
export interface ChaosRow {
  id: string;
  /** classifyRow → 'SCHEMA' when true. */
  schema?: boolean;
  /** classifyRow → 'REJECT' when true. */
  reject?: boolean;
}

// ---- the faulted page source ----
export interface ChaosScenario {
  plan: FaultPlan;
  /** Rows requested per page. */
  limit?: number;
  /** Rows a non-faulted page yields. */
  rowsPerPage?: number;
  /** Pages the underlying (fault-free) dataset would span before COMPLETE. */
  totalPages?: number;
  /** Starting clock value (ms). */
  startTimeMs?: number;
  /** PRNG seed for row identity. */
  seed?: number;
}

export interface ChaosRig {
  transport: ProviderTransport<ChaosRow>;
  clock: ChaosClock;
  now: () => number;
  isAborted: () => boolean;
  pagesFetched: () => number;
}

class ChaosPageSource implements PageSource<ChaosRow> {
  readonly style = 'cursor' as const;
  readonly limit: number;
  private page = 0;
  constructor(
    private readonly plan: FaultPlan,
    private readonly cfg: { limit: number; rowsPerPage: number; totalPages: number },
    private readonly rng: SeededRandom,
    private readonly clock: ChaosClock,
    private readonly abortFlag: { aborted: boolean },
  ) {
    this.limit = cfg.limit;
  }

  pagesFetched(): number {
    return this.page;
  }

  private makeRows(count: number, opts: { schema?: boolean; reject?: boolean } = {}): ChaosRow[] {
    const rows: ChaosRow[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = Math.floor(this.rng.next() * 1e9).toString(36);
      rows.push({ id, schema: opts.schema, reject: opts.reject });
    }
    return rows;
  }

  async fetchPage(_req: PageRequest): Promise<PageResult<ChaosRow>> {
    this.page += 1;
    const page1 = this.page;
    const fault = faultForPage(this.plan, page1);

    // A SIGNAL fault throws before any rows are produced (apply scheduled clock jump + abort first so the
    // pre-throw time/abort state is still deterministic for the caller's deadline accounting).
    this.applyClockJump(page1);
    this.applyAbort(page1);

    if (fault.kind === 'SIGNAL') {
      throw new ProviderSignal(fault.signal, fault.message ?? `chaos_${fault.signal.toLowerCase()}`, fault.retryAfterMs);
    }

    const hasMoreNatural = page1 < this.cfg.totalPages;
    const naturalNext = hasMoreNatural ? `cur:${page1}` : null;

    switch (fault.kind) {
      case 'REPEATED_CURSOR':
        return { rows: this.makeRows(this.cfg.rowsPerPage), nextCursor: fault.cursor };
      case 'TRUNCATED_PAGE':
        return { rows: this.makeRows(Math.max(0, Math.min(fault.rows, this.cfg.rowsPerPage))), nextCursor: naturalNext };
      case 'SCHEMA_ROWS':
        return { rows: this.makeRows(this.cfg.rowsPerPage, { schema: true }), nextCursor: naturalNext };
      case 'REJECT_ROWS':
        return { rows: this.makeRows(this.cfg.rowsPerPage, { reject: true }), nextCursor: naturalNext };
      case 'NONE':
      default:
        return { rows: this.makeRows(this.cfg.rowsPerPage), nextCursor: naturalNext };
    }
  }

  private applyClockJump(page1: number): void {
    const jump = this.plan.clockJumpsMs?.[page1 - 1];
    if (jump != null && jump > 0) this.clock.advance(jump);
  }

  private applyAbort(page1: number): void {
    if (this.plan.abortFromPage != null && page1 >= this.plan.abortFromPage) this.abortFlag.aborted = true;
  }
}

/**
 * Build a fully deterministic chaos rig: a ProviderTransport + clock + isAborted the executor can be driven
 * with. The transport's classifier maps the scripted row flags to ACCEPT/REJECT/SCHEMA so in-band drift and
 * quarantine candidates are exercisable alongside thrown signals.
 */
export function buildChaosRig(scenario: ChaosScenario): ChaosRig {
  const limit = scenario.limit ?? 50;
  const rowsPerPage = scenario.rowsPerPage ?? limit;
  const totalPages = scenario.totalPages ?? 1;
  const clock = new ChaosClock(scenario.startTimeMs ?? 0);
  const rng = new SeededRandom(scenario.seed ?? 1);
  const abortFlag = { aborted: false };
  const source = new ChaosPageSource(scenario.plan, { limit, rowsPerPage, totalPages }, rng, clock, abortFlag);

  const transport: ProviderTransport<ChaosRow> = {
    provider: 'chaos',
    pageSource(_job: SyncJob): PageSource<ChaosRow> {
      return source;
    },
    classifyRow(row: ChaosRow): 'ACCEPT' | 'REJECT' | 'SCHEMA' {
      if (row.schema) return 'SCHEMA';
      if (row.reject) return 'REJECT';
      return 'ACCEPT';
    },
  };

  return {
    transport,
    clock,
    now: () => clock.now(),
    isAborted: () => abortFlag.aborted,
    pagesFetched: () => source.pagesFetched(),
  };
}
