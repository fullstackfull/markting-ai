/**
 * Phase 5H — durable commerce SYNC engine. Incremental, cursor-based, idempotent, tenant-scoped,
 * retry-safe, bounded, and observable with a dead-letter trail. It NEVER re-fetches full order history
 * each run: it persists a checkpoint (cursor + high-water timestamp) and resumes from it. Backfill is
 * an explicit bounded window, not an unbounded replay.
 *
 * This module is the pure state machine + orchestration; persistence is injected (a SyncStore port) so
 * the same logic is exercised in unit tests and backed by Postgres in production (store.ts).
 */
import type { CommerceConnector, SyncWindow } from './connector';
import type { Order, CommercePlatform } from './model';

export interface SyncCheckpoint {
  connectionId: string;
  organizationId: string;
  platform: CommercePlatform;
  cursor?: string;
  /** High-water mark: the newest createdAt successfully ingested (ISO). */
  highWater?: string;
  lastRunAt?: string;
  status: 'idle' | 'running' | 'error';
  consecutiveErrors: number;
}

export interface DeadLetter {
  connectionId: string;
  kind: 'order_batch' | 'webhook';
  detail: string;
  occurredAt: string;
  payloadRef?: string;
}

export interface SyncStore {
  getCheckpoint(connectionId: string): Promise<SyncCheckpoint | null>;
  saveCheckpoint(cp: SyncCheckpoint): Promise<void>;
  /** Idempotent upsert of orders keyed by (organization_id, order_id). Returns count newly-affected. */
  upsertOrders(organizationId: string, orders: Order[]): Promise<number>;
  deadLetter(dl: DeadLetter): Promise<void>;
}

export interface SyncResult {
  connectionId: string;
  pages: number;
  ordersIngested: number;
  newHighWater?: string;
  status: 'completed' | 'partial' | 'error';
  errors: string[];
}

/** Bound on pages per run so a sync is always bounded (never an unbounded full-history scan). */
export const MAX_PAGES_PER_RUN = 50;

/**
 * Run an incremental sync. Resumes from the stored checkpoint's cursor/high-water, paginates up to
 * MAX_PAGES_PER_RUN, upserts idempotently, advances the checkpoint, and dead-letters a failed page
 * without losing the checkpoint (retry-safe). Returns an observable result.
 */
export async function runIncrementalSync(input: {
  connector: CommerceConnector;
  store: SyncStore;
  connectionId: string;
  organizationId: string;
  /** The window to sync. Defaults to [highWater or epoch, now]. */
  window?: SyncWindow;
  now?: number;
}): Promise<SyncResult> {
  const now = input.now ?? Date.now();
  const platform = input.connector.platform;
  let cp = (await input.store.getCheckpoint(input.connectionId)) ?? {
    connectionId: input.connectionId, organizationId: input.organizationId, platform, status: 'idle' as const, consecutiveErrors: 0,
  };
  const window: SyncWindow = input.window ?? { start: cp.highWater ?? '1970-01-01T00:00:00.000Z', end: new Date(now).toISOString() };

  cp = { ...cp, status: 'running', lastRunAt: new Date(now).toISOString() };
  await input.store.saveCheckpoint(cp);

  const result: SyncResult = { connectionId: input.connectionId, pages: 0, ordersIngested: 0, newHighWater: cp.highWater, status: 'completed', errors: [] };
  let cursor = cp.cursor;
  try {
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const { orders, nextCursor } = await input.connector.listOrders({ connectionId: input.connectionId, window, cursor });
      result.pages += 1;
      if (orders.length) {
        // stamp org on the orders (server-derived; never from payload)
        const scoped = orders.map((o) => ({ ...o, organizationId: input.organizationId }));
        const affected = await input.store.upsertOrders(input.organizationId, scoped);
        result.ordersIngested += affected;
        const maxCreated = scoped.reduce((m, o) => (o.createdAt > m ? o.createdAt : m), result.newHighWater ?? '');
        if (maxCreated) result.newHighWater = maxCreated;
      }
      cursor = nextCursor;
      if (!cursor) break;
      if (page === MAX_PAGES_PER_RUN - 1) result.status = 'partial'; // more remains; next run resumes
    }
    cp = { ...cp, cursor, highWater: result.newHighWater, status: 'idle', consecutiveErrors: 0, lastRunAt: new Date(now).toISOString() };
    await input.store.saveCheckpoint(cp);
  } catch (e) {
    const detail = String((e as Error).message ?? e);
    result.status = 'error';
    result.errors.push(detail);
    cp = { ...cp, status: 'error', consecutiveErrors: cp.consecutiveErrors + 1, lastRunAt: new Date(now).toISOString() };
    await input.store.saveCheckpoint(cp); // checkpoint preserved for retry — no data loss
    await input.store.deadLetter({ connectionId: input.connectionId, kind: 'order_batch', detail, occurredAt: new Date(now).toISOString() });
  }
  return result;
}

/** Explicit bounded backfill window (never an unbounded replay). */
export function backfillWindow(fromIso: string, toIso: string, maxDays = 400): SyncWindow {
  const from = Date.parse(fromIso); const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('invalid backfill window');
  if ((to - from) / 86_400_000 > maxDays) throw new Error(`backfill window exceeds ${maxDays} days (bounded)`);
  return { start: fromIso, end: toIso };
}
