import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricPoint, TraceSpan } from '@/lib/markting/ops/observability';
import {
  BatchBuffer,
  PrometheusTextExporter,
  StatsdTextExporter,
  OpenTelemetryExporter,
  bufferedMetrics,
  bufferedSpans,
  droppedMetrics,
  droppedSpans,
  flushMetrics,
  flushSpans,
  getTraceExporter,
  recordMetric,
  recordSpan,
  renderPrometheusHistogram,
  resetMetricsForTests,
  setMetricBufferLimit,
  setSpanBufferLimit,
  setTraceExporter,
} from '@/lib/markting/ops/exporter';

/**
 * Phase C.6 (22) — exporter seam round-out. Bounded drop-oldest batching + flush to the installed
 * exporter, deterministic Prometheus histograms, a pure StatsD renderer, a trace-span registry, and the
 * OTLP adapter still a blocked-external buffering stub. No exporter throws into callers; no network I/O.
 */
const AT = '2026-10-04T12:00:00.000Z';
const point = (over: Partial<MetricPoint> = {}): MetricPoint => ({ name: 'request_latency_ms', value: 123, at: AT, ...over });
const span = (over: Partial<TraceSpan> = {}): TraceSpan => ({ name: 's', traceId: 't1', startedAt: AT, ...over });

afterEach(() => resetMetricsForTests());

describe('C.6-22 — BatchBuffer bounded drop-oldest', () => {
  it('evicts the oldest when over the limit and counts drops', () => {
    const b = new BatchBuffer<number>(3);
    b.add(1, 2, 3, 4, 5);
    expect(b.peek()).toEqual([3, 4, 5]);
    expect(b.size()).toBe(3);
    expect(b.dropped()).toBe(2);
  });

  it('flush routes the batch to a sink and clears', () => {
    const b = new BatchBuffer<number>(10);
    b.add(1, 2);
    const sink = vi.fn();
    b.flush(sink);
    expect(sink).toHaveBeenCalledWith([1, 2]);
    expect(b.size()).toBe(0);
    b.flush(sink); // empty flush is a no-op
    expect(sink).toHaveBeenCalledOnce();
  });

  it('a throwing sink never escapes and the failed batch is counted as dropped', () => {
    const b = new BatchBuffer<number>(10);
    b.add(1, 2, 3);
    expect(() => b.flush(() => { throw new Error('backend down'); })).not.toThrow();
    expect(b.size()).toBe(0);
    expect(b.dropped()).toBe(3);
  });
});

describe('C.6-22 — metric buffer is bounded (drop-oldest) and flushes to installed exporter', () => {
  it('drops oldest beyond the configured limit', () => {
    setMetricBufferLimit(2);
    recordMetric('queue_depth', 1);
    recordMetric('queue_depth', 2);
    recordMetric('queue_depth', 3);
    expect(bufferedMetrics().map((p) => p.value)).toEqual([2, 3]);
    expect(droppedMetrics()).toBe(1);
  });
});

describe('C.6-22 — PrometheusTextExporter histograms', () => {
  it('renders TYPE histogram with cumulative buckets, +Inf, _sum and _count deterministically', () => {
    const lines = renderPrometheusHistogram({
      name: 'ai_latency_ms',
      buckets: [{ le: 100, count: 1 }, { le: 50, count: 0 }, { le: 250, count: 3 }],
      sum: 400,
      count: 3,
      organizationId: 'o1',
      at: AT,
    });
    expect(lines[0]).toBe('# TYPE ai_latency_ms histogram');
    // sorted ascending by le, +Inf appended last
    expect(lines[1]).toBe('ai_latency_ms_bucket{organization_id="o1",le="50"} 0 1791115200000');
    expect(lines[2]).toBe('ai_latency_ms_bucket{organization_id="o1",le="100"} 1 1791115200000');
    expect(lines[3]).toBe('ai_latency_ms_bucket{organization_id="o1",le="250"} 3 1791115200000');
    expect(lines[4]).toBe('ai_latency_ms_bucket{organization_id="o1",le="+Inf"} 3 1791115200000');
    expect(lines[5]).toBe('ai_latency_ms_sum{organization_id="o1"} 400 1791115200000');
    expect(lines[6]).toBe('ai_latency_ms_count{organization_id="o1"} 3 1791115200000');
  });

  it('renders counters, gauges and histograms together in one deterministic document', () => {
    const exp = new PrometheusTextExporter();
    exp.export([point({ name: 'write_success', value: 2 }), point({ name: 'queue_depth', value: 9 })]);
    exp.exportHistogram({ name: 'ai_latency_ms', buckets: [{ le: 100, count: 2 }], sum: 150, count: 2 });
    const text = exp.render();
    expect(text).toContain('# TYPE write_success counter');
    expect(text).toContain('# TYPE queue_depth gauge');
    expect(text).toContain('# TYPE ai_latency_ms histogram');
    expect(text).toContain('ai_latency_ms_bucket{le="+Inf"} 2');
    expect(exp.histograms()).toHaveLength(1);
    exp.reset();
    expect(exp.render()).toBe('');
  });
});

describe('C.6-22 — StatsdTextExporter is a pure string renderer with redacted tags', () => {
  it('renders counters as |c, gauges as |g, with sorted org+label tags, and redacts secrets', () => {
    const exp = new StatsdTextExporter();
    exp.export([
      point({ name: 'write_success', value: 4, organizationId: 'o1', labels: { provider: 'meta', token: 'sk-live' } }),
      point({ name: 'queue_depth', value: 7 }),
    ]);
    const text = exp.render();
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe('write_success:4|c|#organization_id:o1,provider:meta,token:[REDACTED]');
    expect(lines[1]).toBe('queue_depth:7|g');
    expect(text).not.toContain('sk-live');
  });

  it('empty buffer renders empty string', () => {
    expect(new StatsdTextExporter().render()).toBe('');
  });
});

describe('C.6-22 — trace span registry', () => {
  it('recordSpan redacts attributes, buffers (bounded), and flushSpans routes to the installed exporter', () => {
    const spy = { export: vi.fn() };
    setTraceExporter(spy);
    expect(getTraceExporter()).toBe(spy);
    const s = recordSpan(span({ attributes: { stage: 'approval', access_token: 'secret-abc' } }));
    expect(s.attributes).toEqual({ stage: 'approval', access_token: '[REDACTED]' });
    expect(bufferedSpans()).toHaveLength(1);
    flushSpans();
    expect(spy.export).toHaveBeenCalledOnce();
    expect(spy.export.mock.calls[0]![0][0].attributes.access_token).toBe('[REDACTED]');
    expect(bufferedSpans()).toHaveLength(0);
  });

  it('span buffer drops oldest beyond the limit and a throwing exporter never breaks the caller', () => {
    setSpanBufferLimit(1);
    recordSpan(span({ name: 'a' }));
    recordSpan(span({ name: 'b' }));
    expect(bufferedSpans().map((s) => s.name)).toEqual(['b']);
    expect(droppedSpans()).toBe(1);
    setTraceExporter({ export() { throw new Error('down'); } });
    expect(() => flushSpans()).not.toThrow();
  });
});

describe('C.6-22 — OpenTelemetryExporter stays a blocked-external buffering stub', () => {
  it('buffers metrics and spans with no network client', () => {
    const exp = new OpenTelemetryExporter('https://collector.example:4318');
    expect(exp.blockedExternal).toBe('OTLP_COLLECTOR_ENDPOINT');
    exp.export([point()]);
    exp.export([span()]);
    expect(exp.buffered().metrics).toHaveLength(1);
    expect(exp.buffered().spans).toHaveLength(1);
  });
});
