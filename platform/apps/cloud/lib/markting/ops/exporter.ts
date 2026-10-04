import { redactLog, type MetricName, type MetricPoint, type TraceSpan } from './observability';

/**
 * Phase C.5 (6) — OBSERVABILITY EXPORT SEAM.
 *
 * A clean, backend-agnostic boundary between "the app emits a metric/trace" and "a metrics backend
 * receives it". The app never talks to a specific vendor SDK: it records points through a tiny
 * in-process buffer (`recordMetric`) and a single installed exporter. Swapping the exporter is the
 * only wiring step, so the default build (CI/tests) stays pure and does NO external I/O.
 *
 * Adapters shipped here are deliberately I/O-free:
 *   - NoopExporter             — the default; drops everything (CI/tests).
 *   - ConsoleLogExporter       — structured-log backend; every payload goes through `redactLog`.
 *   - PrometheusTextExporter   — buffers points and RENDERS the Prometheus text exposition format as
 *                                a pure string (no HTTP server; a /metrics handler is a later edge step).
 *   - OpenTelemetryExporter    — BLOCKED_EXTERNAL adapter STUB. It implements the interface and
 *                                buffers, but intentionally ships NO OTLP network client. Wiring a real
 *                                OTLP exporter against a collector endpoint is a deployment step.
 */

/** Receives a batch of already-buffered metric points. Implementations must not throw into callers. */
export interface MetricExporter {
  export(points: MetricPoint[]): void;
}

/** Receives a batch of trace spans. Implementations must not throw into callers. */
export interface TraceExporter {
  export(spans: TraceSpan[]): void;
}

// ---- Adapters -------------------------------------------------------------

/** The default. Drops everything — no buffer, no I/O. Used in CI and tests. */
export class NoopExporter implements MetricExporter, TraceExporter {
  export(_items: MetricPoint[] | TraceSpan[]): void {
    // intentionally nothing: no backend wired in-process.
  }
}

/**
 * Structured-log backend adapter. Emits one secret-redacted JSON line per batch via an injected
 * `log` sink (default `console.log`). Every payload is run through `redactLog`, so a token/secret-
 * looking field can never reach the log backend.
 */
export class ConsoleLogExporter implements MetricExporter, TraceExporter {
  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  export(items: MetricPoint[] | TraceSpan[]): void {
    const first = items[0];
    if (!first) return;
    const kind = 'name' in first && 'value' in first ? 'metrics' : 'traces';
    this.log(JSON.stringify(redactLog({ observability: kind, count: items.length, items })));
  }
}

const PROM_TYPE: Partial<Record<MetricName, 'counter' | 'gauge'>> = {
  write_success: 'counter',
  write_failure: 'counter',
  unknown_result_count: 'counter',
};

function promMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function promLabelName(name: string): string {
  // organizationId -> organization_id; any non-conforming char -> underscore.
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_');
}

function promLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** A pre-aggregated histogram snapshot (cumulative buckets). Rendered, never computed, here. */
export interface HistogramSnapshot {
  name: string;
  /** Upper bounds with their cumulative counts; `Infinity` is the implicit +Inf bucket. */
  buckets: Array<{ le: number; count: number }>;
  sum: number;
  count: number;
  organizationId?: string;
  labels?: Record<string, string>;
  at?: string;
}

function promLabelPairs(organizationId: string | undefined, labels: Record<string, string> | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (organizationId) out.push(['organization_id', organizationId]);
  for (const [k, v] of Object.entries(labels ?? {})) out.push([promLabelName(k), v]);
  return out;
}

function promLabelSet(pairs: Array<[string, string]>): string {
  return pairs.length ? `{${pairs.map(([k, v]) => `${promLabelName(k)}="${promLabelValue(v)}"`).join(',')}}` : '';
}

/** Render one histogram deterministically (buckets sorted ascending, +Inf last) in Prometheus text form. */
export function renderPrometheusHistogram(snap: HistogramSnapshot): string[] {
  const metric = promMetricName(snap.name);
  const base = promLabelPairs(snap.organizationId, snap.labels);
  const ts = snap.at ? Date.parse(snap.at) : NaN;
  const suffix = Number.isFinite(ts) ? ` ${ts}` : '';
  const buckets = [...snap.buckets].sort((a, b) => a.le - b.le);
  const hasInf = buckets.some((b) => !Number.isFinite(b.le));
  if (!hasInf) buckets.push({ le: Infinity, count: snap.count });
  const lines: string[] = [`# TYPE ${metric} histogram`];
  for (const b of buckets) {
    const le = Number.isFinite(b.le) ? String(b.le) : '+Inf';
    lines.push(`${metric}_bucket${promLabelSet([...base, ['le', le]])} ${b.count}${suffix}`);
  }
  lines.push(`${metric}_sum${promLabelSet(base)} ${snap.sum}${suffix}`);
  lines.push(`${metric}_count${promLabelSet(base)} ${snap.count}${suffix}`);
  return lines;
}

/**
 * Buffers metric points and renders them in the Prometheus text exposition format. PURE string
 * output: `export` only appends to the in-memory buffer and `render` returns the text — nothing is
 * served or flushed over a socket. Points are grouped by metric name (names sorted for determinism),
 * each group prefixed with a `# TYPE` line; `organizationId` is rendered as the `organization_id`
 * label alongside any `labels`, and the point's `at` is emitted as the millisecond sample timestamp.
 */
export class PrometheusTextExporter implements MetricExporter {
  private buffer: MetricPoint[] = [];
  private histBuffer: HistogramSnapshot[] = [];

  export(points: MetricPoint[]): void {
    this.buffer.push(...points);
  }

  /** Buffer a pre-aggregated histogram snapshot for rendering alongside counters/gauges. */
  exportHistogram(snapshots: HistogramSnapshot | HistogramSnapshot[]): void {
    this.histBuffer.push(...(Array.isArray(snapshots) ? snapshots : [snapshots]));
  }

  /** Points buffered so far (defensive copy). */
  points(): MetricPoint[] {
    return [...this.buffer];
  }

  /** Histogram snapshots buffered so far (defensive copy). */
  histograms(): HistogramSnapshot[] {
    return [...this.histBuffer];
  }

  reset(): void {
    this.buffer = [];
    this.histBuffer = [];
  }

  render(): string {
    const byName = new Map<string, MetricPoint[]>();
    for (const p of this.buffer) {
      const arr = byName.get(p.name) ?? [];
      arr.push(p);
      byName.set(p.name, arr);
    }
    const lines: string[] = [];
    for (const name of [...byName.keys()].sort()) {
      const metric = promMetricName(name);
      lines.push(`# TYPE ${metric} ${PROM_TYPE[name as MetricName] ?? 'gauge'}`);
      for (const p of byName.get(name)!) {
        const rendered = promLabelSet(promLabelPairs(p.organizationId, p.labels));
        const ts = Date.parse(p.at);
        lines.push(`${metric}${rendered} ${p.value}${Number.isFinite(ts) ? ` ${ts}` : ''}`);
      }
    }
    // Histograms render after scalar metrics, grouped by name for determinism.
    const histByName = new Map<string, HistogramSnapshot[]>();
    for (const h of this.histBuffer) {
      const arr = histByName.get(h.name) ?? [];
      arr.push(h);
      histByName.set(h.name, arr);
    }
    for (const name of [...histByName.keys()].sort()) {
      for (const snap of histByName.get(name)!) lines.push(...renderPrometheusHistogram(snap));
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
  }
}

/**
 * StatsD-style text exporter — a second pure-string renderer (no UDP socket, no I/O). Buffers metric
 * points and renders one `name:value|<type>` line each (`|c` for counters, `|g` for gauges), appending
 * secret-redacted DogStatsD-style `|#tag:value` tags built from `organizationId` + `labels`. Deterministic:
 * lines are emitted in buffer order and tags are sorted by key.
 */
export class StatsdTextExporter implements MetricExporter {
  private buffer: MetricPoint[] = [];

  export(points: MetricPoint[]): void {
    this.buffer.push(...points);
  }

  points(): MetricPoint[] {
    return [...this.buffer];
  }

  reset(): void {
    this.buffer = [];
  }

  render(): string {
    const lines: string[] = [];
    for (const p of this.buffer) {
      const type = (PROM_TYPE[p.name] ?? 'gauge') === 'counter' ? 'c' : 'g';
      const safeLabels = redactLog(p.labels ?? {});
      const tags: string[] = [];
      if (p.organizationId) tags.push(`organization_id:${p.organizationId}`);
      for (const [k, v] of Object.entries(safeLabels).sort(([a], [b]) => a.localeCompare(b))) {
        tags.push(`${promLabelName(k)}:${String(v)}`);
      }
      const tagStr = tags.length ? `|#${tags.join(',')}` : '';
      lines.push(`${promMetricName(p.name)}:${p.value}|${type}${tagStr}`);
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
  }
}

/**
 * BLOCKED_EXTERNAL — OpenTelemetry adapter STUB. It satisfies the exporter interface so callers can be
 * pointed at it, and it BUFFERS spans/points so nothing is lost, but it deliberately ships NO OTLP
 * network client (no sockets, no fetch). Turning this into a live exporter — constructing an OTLP
 * gRPC/HTTP client against a collector endpoint — is a DEPLOYMENT step, not an in-process one. Until
 * then it is a documented no-op over the wire.
 */
export class OpenTelemetryExporter implements MetricExporter, TraceExporter {
  /** Marks this as the architecture seam that still needs a collector endpoint wired at deploy time. */
  readonly blockedExternal = 'OTLP_COLLECTOR_ENDPOINT' as const;
  private readonly metricBuffer: MetricPoint[] = [];
  private readonly spanBuffer: TraceSpan[] = [];

  constructor(readonly endpoint?: string) {}

  export(items: MetricPoint[] | TraceSpan[]): void {
    const first = items[0];
    if (!first) return;
    if ('value' in first) this.metricBuffer.push(...(items as MetricPoint[]));
    else this.spanBuffer.push(...(items as TraceSpan[]));
    // No OTLP client wired: a real exporter is attached at deployment against `this.endpoint`.
  }

  buffered(): { metrics: MetricPoint[]; spans: TraceSpan[] } {
    return { metrics: [...this.metricBuffer], spans: [...this.spanBuffer] };
  }
}

// ---- Bounded batching buffer ---------------------------------------------

/**
 * A bounded in-memory batch buffer with a DROP-OLDEST overflow policy. When `add` would exceed
 * `limit`, the oldest items are evicted (and counted in `dropped`) so memory stays bounded under
 * backpressure — recent data is kept over stale data. `flush(sink)` hands the batch to a sink and
 * clears; the sink runs inside a try/catch so a failing backend never throws into the caller, and on
 * failure the batch is dropped (counted) rather than re-buffered unboundedly.
 */
export class BatchBuffer<T> {
  private items: T[] = [];
  private droppedCount = 0;

  constructor(readonly limit = 10_000) {}

  add(...next: T[]): void {
    for (const item of next) {
      if (this.items.length >= this.limit) {
        this.items.shift(); // drop oldest
        this.droppedCount++;
      }
      this.items.push(item);
    }
  }

  size(): number {
    return this.items.length;
  }

  /** Total items evicted by the drop-oldest policy (plus flush-failure drops). */
  dropped(): number {
    return this.droppedCount;
  }

  peek(): T[] {
    return [...this.items];
  }

  /** Route the batch to a sink and clear. Never throws; a sink failure drops the batch (counted). */
  flush(sink: (batch: T[]) => void): void {
    if (this.items.length === 0) return;
    const batch = this.items;
    this.items = [];
    try {
      sink(batch);
    } catch {
      this.droppedCount += batch.length; // a backend failure must not break the caller or re-storm.
    }
  }

  reset(): void {
    this.items = [];
    this.droppedCount = 0;
  }
}

// ---- Registry + uniform emit ---------------------------------------------

let activeExporter: MetricExporter = new NoopExporter();
let buffer: MetricPoint[] = [];
let metricBufferLimit = 10_000;
let metricsDropped = 0;
let activeTraceExporter: TraceExporter = new NoopExporter();
let spanBuffer: TraceSpan[] = [];
let spanBufferLimit = 10_000;
let spansDropped = 0;

/** Install the active metric exporter (e.g. in production). Returns a restore function. */
export function setMetricExporter(next: MetricExporter): () => void {
  const prev = activeExporter;
  activeExporter = next;
  return () => { activeExporter = prev; };
}

/** The currently installed exporter (for tests/introspection). */
export function getMetricExporter(): MetricExporter {
  return activeExporter;
}

/**
 * Record a metric point into the in-process buffer. Callers emit uniformly through this — they never
 * touch an exporter directly. Pure and synchronous: it only appends (no I/O). `flushMetrics` hands the
 * buffer to the active exporter.
 */
export function recordMetric(
  name: MetricName,
  value: number,
  opts: { organizationId?: string; labels?: Record<string, string>; at?: string } = {},
): MetricPoint {
  const point: MetricPoint = {
    name,
    value,
    organizationId: opts.organizationId,
    labels: opts.labels,
    at: opts.at ?? new Date().toISOString(),
  };
  if (buffer.length >= metricBufferLimit) { buffer.shift(); metricsDropped++; } // bounded: drop oldest.
  buffer.push(point);
  return point;
}

/** Set the max buffered metric points (drop-oldest beyond this). Returns the previous limit. */
export function setMetricBufferLimit(limit: number): number {
  const prev = metricBufferLimit;
  metricBufferLimit = Math.max(1, Math.floor(limit));
  return prev;
}

/** Count of metric points evicted by the drop-oldest policy. */
export function droppedMetrics(): number {
  return metricsDropped;
}

/** Points buffered but not yet flushed (defensive copy). */
export function bufferedMetrics(): MetricPoint[] {
  return [...buffer];
}

/** Hand the buffered points to the active exporter and clear the buffer. Never throws into the caller. */
export function flushMetrics(): void {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    activeExporter.export(batch);
  } catch {
    // an exporter must never break the caller's path.
  }
}

// ---- Trace span registry (mirrors the metric seam) -----------------------

/** Install the active trace exporter. Returns a restore function. */
export function setTraceExporter(next: TraceExporter): () => void {
  const prev = activeTraceExporter;
  activeTraceExporter = next;
  return () => { activeTraceExporter = prev; };
}

/** The currently installed trace exporter (for tests/introspection). */
export function getTraceExporter(): TraceExporter {
  return activeTraceExporter;
}

/** Set the max buffered spans (drop-oldest beyond this). Returns the previous limit. */
export function setSpanBufferLimit(limit: number): number {
  const prev = spanBufferLimit;
  spanBufferLimit = Math.max(1, Math.floor(limit));
  return prev;
}

/** Count of spans evicted by the drop-oldest policy. */
export function droppedSpans(): number {
  return spansDropped;
}

/**
 * Record a trace span into the bounded in-process buffer. Attributes are secret-redacted on the way in,
 * so a token/secret-looking attribute can never reach an exporter. Pure + synchronous (append only).
 */
export function recordSpan(span: TraceSpan): TraceSpan {
  const safe: TraceSpan = { ...span, attributes: span.attributes ? redactLog(span.attributes) : undefined };
  if (spanBuffer.length >= spanBufferLimit) { spanBuffer.shift(); spansDropped++; } // bounded: drop oldest.
  spanBuffer.push(safe);
  return safe;
}

/** Spans buffered but not yet flushed (defensive copy). */
export function bufferedSpans(): TraceSpan[] {
  return [...spanBuffer];
}

/** Hand buffered spans to the active trace exporter and clear. Never throws into the caller. */
export function flushSpans(): void {
  if (spanBuffer.length === 0) return;
  const batch = spanBuffer;
  spanBuffer = [];
  try {
    activeTraceExporter.export(batch);
  } catch {
    // an exporter must never break the caller's path.
  }
}

/** Reset the registry + buffers (metrics + traces). For tests. */
export function resetMetricsForTests(): void {
  activeExporter = new NoopExporter();
  buffer = [];
  metricBufferLimit = 10_000;
  metricsDropped = 0;
  activeTraceExporter = new NoopExporter();
  spanBuffer = [];
  spanBufferLimit = 10_000;
  spansDropped = 0;
}
