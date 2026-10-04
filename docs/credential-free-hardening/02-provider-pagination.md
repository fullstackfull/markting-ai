# 02 — Generic provider pagination (item 3)

`lib/markting/ops/provider-pagination.ts` + covered by `test/provider-executor.test.ts` (C.6-3 block).

## Problem

Providers paginate differently: `next_page_token`, `cursor`, `paging.next`, `offset/limit`, and
`continuation` tokens. We normalize only the **traversal semantics** — "given the last page, is there a
next request and what is it?" — without forcing one wire format.

## Model

- `PageSource<Row>` describes how to read **one** page (`fetchPage(req)`) and declares its `style` +
  `limit`. Injected; a fake in tests, never a network client here.
- `paginate(source, limits, opts)` drives the loop and returns `{ rows, pages, stop, resumeCursor }`.

## Never trust the provider to terminate

The loop is bounded on every axis and stops at whichever comes first:

- `maxPages` → `MAX_PAGES`
- `maxRows` → `MAX_ROWS` (carries the next cursor so the run resumes, not restarts)
- `deadlineMs` (injected clock) → `DEADLINE`
- cooperative `isAborted()` → `ABORTED`
- a **repeated non-null cursor** (seen-set guard; offset style keys on `off:<next>`) → `LOOP_DETECTED`,
  so a provider that echoes the same cursor can never spin forever
- `nextCursor == null` → `COMPLETE`

`onPage` is an observability hook. The function is pure over the injected `fetchPage` + clock, so loop
protection and bounded iteration are verified with no network.
