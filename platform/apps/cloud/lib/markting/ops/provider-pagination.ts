import 'server-only';

/**
 * PHASE C.6 (3) — GENERIC PROVIDER PAGINATION.
 *
 * Providers paginate differently (nextPageToken, cursor, paging.next, offset/limit, continuation token).
 * This normalizes only the TRAVERSAL SEMANTICS — "given the last page, is there a next request, and what
 * is it?" — without forcing a single wire format. A `PageSource` describes how to read ONE page and how
 * to find the next cursor; `paginate` drives the loop with hard loop-protection (max pages + a seen-cursor
 * guard so a provider that echoes the same cursor can never spin forever). Pure over an injected fetch
 * (fake transport in tests — no network).
 */

export type PageStyle = 'next_page_token' | 'cursor' | 'paging_next' | 'offset_limit' | 'continuation';

export interface PageRequest {
  /** Opaque cursor/token for the NEXT page, or an offset for offset/limit style. null = first page. */
  cursor: string | null;
  offset?: number;
  limit: number;
}

export interface PageResult<Row> {
  rows: Row[];
  /** The next cursor/token, or null when there are no more pages. */
  nextCursor: string | null;
}

export interface PageSource<Row> {
  style: PageStyle;
  limit: number;
  /** Fetch exactly one page for the given request. Injected (fake in tests). */
  fetchPage(req: PageRequest): Promise<PageResult<Row>>;
}

export interface PaginateLimits {
  /** Hard cap on pages per run (bounded iteration). */
  maxPages: number;
  /** Hard cap on total rows (bounded dataset). */
  maxRows: number;
  /** Optional deadline (epoch ms); traversal stops when exceeded. */
  deadlineMs?: number;
}

export type PaginateStop = 'COMPLETE' | 'MAX_PAGES' | 'MAX_ROWS' | 'DEADLINE' | 'LOOP_DETECTED' | 'ABORTED';

export interface PaginateResult<Row> {
  rows: Row[];
  pages: number;
  stop: PaginateStop;
  /** The cursor the run stopped at (for resumable continuation), or null when COMPLETE. */
  resumeCursor: string | null;
}

export interface PaginateOptions {
  now?: () => number;
  /** Cooperative cancellation — when it returns true between pages, traversal stops as ABORTED. */
  isAborted?: () => boolean;
  /** Called after each page (observability hook). */
  onPage?: (info: { page: number; rows: number; cursor: string | null }) => void;
}

/**
 * Drive a paginated read with loop-protection + bounded iteration. Never trusts the provider to
 * terminate: it stops at maxPages, maxRows, the deadline, cancellation, OR when a cursor repeats
 * (LOOP_DETECTED) — whichever comes first.
 */
export async function paginate<Row>(source: PageSource<Row>, limits: PaginateLimits, opts: PaginateOptions = {}): Promise<PaginateResult<Row>> {
  const now = opts.now ?? Date.now;
  const rows: Row[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let offset = 0;
  let page = 0;

  while (true) {
    if (opts.isAborted?.()) return { rows, pages: page, stop: 'ABORTED', resumeCursor: cursor };
    if (page >= limits.maxPages) return { rows, pages: page, stop: 'MAX_PAGES', resumeCursor: cursor };
    if (limits.deadlineMs != null && now() >= limits.deadlineMs) return { rows, pages: page, stop: 'DEADLINE', resumeCursor: cursor };

    const req: PageRequest = { cursor, offset: source.style === 'offset_limit' ? offset : undefined, limit: source.limit };
    const res = await source.fetchPage(req);
    page += 1;
    for (const r of res.rows) {
      rows.push(r);
      if (rows.length >= limits.maxRows) {
        opts.onPage?.({ page, rows: res.rows.length, cursor: res.nextCursor });
        return { rows, pages: page, stop: 'MAX_ROWS', resumeCursor: res.nextCursor };
      }
    }
    opts.onPage?.({ page, rows: res.rows.length, cursor: res.nextCursor });

    const next = res.nextCursor;
    if (next == null) return { rows, pages: page, stop: 'COMPLETE', resumeCursor: null };

    // Loop protection: a repeated non-null cursor means the provider is not advancing.
    const loopKey = source.style === 'offset_limit' ? `off:${offset + source.limit}` : `cur:${next}`;
    if (seen.has(loopKey)) return { rows, pages: page, stop: 'LOOP_DETECTED', resumeCursor: next };
    seen.add(loopKey);

    cursor = next;
    offset += source.limit;
  }
}
