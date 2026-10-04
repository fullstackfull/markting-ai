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

/**
 * Buffers metric points and renders them in the Prometheus text exposition format. PURE string
 * output: `export` only appends to the in-memory buffer and `render` returns the text — nothing is
 * served or flushed over a socket. Points are grouped by metric name (names sorted for determinism),
 * each group prefixed with a `# TYPE` line; `organizationId` is rendered as the `organization_id`
 * label alongside any `labels`, and the point's `at` is emitted as the millisecond sample timestamp.
 */
export class PrometheusTextExporter implements MetricExporter {
  private buffer: MetricPoint[] = [];

  export(points: MetricPoint[]): void {
    this.buffer.push(...points);
  }

  /** Points buffered so far (defensive copy). */
  points(): MetricPoint[] {
    return [...this.buffer];
  }

  reset(): void {
    this.buffer = [];
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
        const labels: Array<[string, string]> = [];
        if (p.organizationId) labels.push(['organization_id', p.organizationId]);
        for (const [k, v] of Object.entries(p.labels ?? {})) labels.push([promLabelName(k), v]);
        const rendered = labels.length
          ? `{${labels.map(([k, v]) => `${promLabelName(k)}="${promLabelValue(v)}"`).join(',')}}`
          : '';
        const ts = Date.parse(p.at);
        lines.push(`${metric}${rendered} ${p.value}${Number.isFinite(ts) ? ` ${ts}` : ''}`);
      }
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

// ---- Registry + uniform emit ---------------------------------------------

let activeExporter: MetricExporter = new NoopExporter();
let buffer: MetricPoint[] = [];

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
  buffer.push(point);
  return point;
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

/** Reset the registry + buffer. For tests. */
export function resetMetricsForTests(): void {
  activeExporter = new NoopExporter();
  buffer = [];
}
