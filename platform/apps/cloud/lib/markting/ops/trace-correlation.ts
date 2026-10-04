import { redactLog, TRACE_STAGES, type TraceSpan } from './observability';

/**
 * Phase C.6 (23) — TRACE CORRELATION model.
 *
 * A PURE, in-process trace-context model for the governed-write pipeline (TRACE_STAGES). It mints and
 * propagates a traceId + spanId + parentId, opens/closes `TraceSpan`s (reusing observability.TraceSpan),
 * stitches a completed set of spans into a tree, and exposes the end-to-end CRITICAL PATH (the root→leaf
 * chain of maximum total duration). Clock + id generator are INJECTABLE, so it is fully deterministic in
 * tests and does NO I/O. Every span attribute passes through `redactLog`, so a secret-looking attribute
 * can never be captured.
 */

/** A W3C-ish trace context: a trace is one id; each span has its own id and (except the root) a parent. */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
  organizationId?: string;
}

/** Injectable clock — returns an ISO-8601 timestamp. Default is wall-clock. */
export type Clock = () => string;
/** Injectable id factory — returns a fresh opaque id. Default is a per-tracer counter. */
export type IdFactory = () => string;

/** An open span: a `TraceSpan` with no `endedAt` yet, plus its owning context. */
export interface OpenSpan {
  span: TraceSpan;
  context: TraceContext;
}

const defaultClock: Clock = () => new Date().toISOString();

/** A deterministic, counter-backed id factory. `prefix` keeps trace/span ids visually distinct. */
export function counterIdFactory(prefix = ''): IdFactory {
  let n = 0;
  return () => `${prefix}${(++n).toString(16).padStart(16, '0')}`;
}

/** Build a fresh root context (new traceId + spanId, no parent). */
export function createRootContext(
  opts: { organizationId?: string; nextId?: IdFactory } = {},
): TraceContext {
  const nextId = opts.nextId ?? counterIdFactory();
  return { traceId: nextId(), spanId: nextId(), organizationId: opts.organizationId };
}

/** Derive a child context: same traceId, a new spanId, parentId = the parent's spanId. */
export function childContext(parent: TraceContext, nextId: IdFactory): TraceContext {
  return { traceId: parent.traceId, spanId: nextId(), parentId: parent.spanId, organizationId: parent.organizationId };
}

/** A tenant-aware correlation id: stable join of tenant + trace, safe to log (no secrets). */
export function correlationId(ctx: Pick<TraceContext, 'traceId' | 'organizationId'>): string {
  return ctx.organizationId ? `${ctx.organizationId}:${ctx.traceId}` : ctx.traceId;
}

/** Open a span for a context. Attributes are redacted; `startedAt` comes from the injected clock. */
export function startSpan(
  name: string,
  ctx: TraceContext,
  opts: { attributes?: Record<string, string>; clock?: Clock } = {},
): OpenSpan {
  const clock = opts.clock ?? defaultClock;
  const span: TraceSpan = {
    name,
    traceId: ctx.traceId,
    parentId: ctx.parentId,
    organizationId: ctx.organizationId,
    startedAt: clock(),
    attributes: opts.attributes ? redactLog(opts.attributes) : undefined,
  };
  return { span, context: ctx };
}

/** Close an open span, stamping `endedAt` and merging any extra (redacted) attributes. */
export function endSpan(
  open: OpenSpan,
  opts: { attributes?: Record<string, string>; clock?: Clock } = {},
): TraceSpan {
  const clock = opts.clock ?? defaultClock;
  const extra = opts.attributes ? redactLog(opts.attributes) : undefined;
  return {
    ...open.span,
    endedAt: clock(),
    attributes: extra ? { ...(open.span.attributes ?? {}), ...extra } : open.span.attributes,
  };
}

// ---- Correlation tree + critical path ------------------------------------

/** A node in the correlation tree: a span, its duration, and its child nodes. */
export interface SpanNode {
  span: TraceSpan;
  /** Milliseconds between startedAt and endedAt (0 for an open or unparseable span). */
  durationMs: number;
  children: SpanNode[];
}

export interface Correlation {
  /** Root nodes (spans with no in-set parent), by first appearance. */
  roots: SpanNode[];
  /** All nodes indexed by spanId (the span's own id, carried in `attributes.spanId`). */
  byId: Map<string, SpanNode>;
  /** The root→leaf chain of greatest cumulative duration. */
  criticalPath: TraceSpan[];
  /** Total duration along the critical path. */
  criticalPathMs: number;
}

function spanDurationMs(span: TraceSpan): number {
  if (!span.endedAt) return 0;
  const start = Date.parse(span.startedAt);
  const end = Date.parse(span.endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

/**
 * Stitch a set of spans into a tree and compute the end-to-end critical path. Each span's own id is read
 * from `attributes.spanId` and its parent from `parentId`; a span whose parent is not in the set is a root.
 * The critical path is the root→leaf chain maximizing summed `durationMs` (ties → first child order).
 */
export function correlate(spans: TraceSpan[]): Correlation {
  const byId = new Map<string, SpanNode>();
  const order: SpanNode[] = [];
  for (const span of spans) {
    const node: SpanNode = { span, durationMs: spanDurationMs(span), children: [] };
    order.push(node);
    const id = span.attributes?.spanId;
    if (id) byId.set(id, node);
  }

  const roots: SpanNode[] = [];
  for (const node of order) {
    const parentId = node.span.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Longest cumulative-duration path from each root; pick the global best.
  let best: TraceSpan[] = [];
  let bestMs = -1;
  const walk = (node: SpanNode, path: TraceSpan[], acc: number): void => {
    const nextPath = [...path, node.span];
    const nextAcc = acc + node.durationMs;
    if (node.children.length === 0) {
      if (nextAcc > bestMs) { bestMs = nextAcc; best = nextPath; }
      return;
    }
    for (const child of node.children) walk(child, nextPath, nextAcc);
  };
  for (const root of roots) walk(root, [], 0);

  return { roots, byId, criticalPath: best, criticalPathMs: Math.max(bestMs, 0) };
}

// ---- Governed-write pipeline tracer --------------------------------------

/**
 * A small stateful tracer bound to an injected clock + id factory. It mints a root context and opens a
 * child span per TRACE_STAGE on demand, stamping each span's own id into `attributes.spanId` so
 * `correlate` can rebuild the tree. Pure + deterministic given deterministic injections.
 */
export class Tracer {
  readonly root: TraceContext;
  private readonly clock: Clock;
  private readonly nextId: IdFactory;

  constructor(opts: { organizationId?: string; clock?: Clock; nextId?: IdFactory } = {}) {
    this.clock = opts.clock ?? defaultClock;
    this.nextId = opts.nextId ?? counterIdFactory();
    this.root = createRootContext({ organizationId: opts.organizationId, nextId: this.nextId });
  }

  correlationId(): string {
    return correlationId(this.root);
  }

  /** Open a child span of the root (or of `parent`), tagging its own spanId as an attribute. */
  open(name: string, opts: { parent?: TraceContext; attributes?: Record<string, string> } = {}): OpenSpan {
    const ctx = childContext(opts.parent ?? this.root, this.nextId);
    return startSpan(name, ctx, { attributes: { ...opts.attributes, spanId: ctx.spanId }, clock: this.clock });
  }

  close(open: OpenSpan, attributes?: Record<string, string>): TraceSpan {
    return endSpan(open, { attributes, clock: this.clock });
  }
}

/**
 * Convenience: trace the whole governed-write pipeline as a root span with one child span per
 * TRACE_STAGE (in order). `durations` optionally advances a deterministic clock by N ms per stage so the
 * critical path is meaningful. Returns the completed spans (root first) ready for `correlate`.
 */
export function traceGovernedWrite(opts: {
  organizationId?: string;
  nextId?: IdFactory;
  /** ms to attribute to each stage; missing stages default to 0. */
  durations?: Partial<Record<(typeof TRACE_STAGES)[number], number>>;
  /** starting epoch ms for the deterministic clock (default 0). */
  startMs?: number;
} = {}): TraceSpan[] {
  const nextId = opts.nextId ?? counterIdFactory();
  let t = opts.startMs ?? 0;
  const clock: Clock = () => new Date(t).toISOString();

  const tracer = new Tracer({ organizationId: opts.organizationId, nextId, clock });
  const rootOpen = startSpan('governed_write', { ...tracer.root }, {
    attributes: { spanId: tracer.root.spanId, pipeline: 'governed_write' },
    clock,
  });

  const out: TraceSpan[] = [];
  for (const stage of TRACE_STAGES) {
    const open = tracer.open(stage, { attributes: { stage } });
    t += Math.max(0, opts.durations?.[stage] ?? 0);
    out.push(tracer.close(open, { stage }));
  }
  // Root spans the whole pipeline; close it last so its duration envelops the children.
  out.unshift(endSpan(rootOpen, { clock }));
  return out;
}
