import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricPoint } from '@/lib/markting/ops/observability';
import {
  ConsoleLogExporter,
  NoopExporter,
  OpenTelemetryExporter,
  PrometheusTextExporter,
  bufferedMetrics,
  flushMetrics,
  getMetricExporter,
  recordMetric,
  resetMetricsForTests,
  setMetricExporter,
} from '@/lib/markting/ops/exporter';

/**
 * Phase C.5 (6) — observability export seam. The default is a no-op (CI/tests), the Prometheus adapter
 * renders pure text, the console adapter redacts secrets, and the OTLP adapter is a buffering stub with
 * no network client.
 */
const AT = '2026-10-04T12:00:00.000Z';
const point = (over: Partial<MetricPoint> = {}): MetricPoint => ({ name: 'request_latency_ms', value: 123, at: AT, ...over });

afterEach(() => resetMetricsForTests());

describe('C.5-6 — NoopExporter', () => {
  it('no-ops and returns nothing', () => {
    const exp = new NoopExporter();
    expect(exp.export([point()])).toBeUndefined();
  });

  it('is the default exporter; recordMetric buffers and flush hits the exporter', () => {
    expect(getMetricExporter()).toBeInstanceOf(NoopExporter);
    const spy = { export: vi.fn() };
    setMetricExporter(spy);
    recordMetric('queue_depth', 7, { organizationId: 'o1', labels: { provider: 'meta' } });
    expect(bufferedMetrics()).toHaveLength(1);
    flushMetrics();
    expect(spy.export).toHaveBeenCalledOnce();
    expect(spy.export.mock.calls[0]![0][0]).toMatchObject({ name: 'queue_depth', value: 7, organizationId: 'o1' });
    expect(bufferedMetrics()).toHaveLength(0); // buffer cleared after flush
  });

  it('a throwing exporter never breaks the caller', () => {
    setMetricExporter({ export() { throw new Error('backend down'); } });
    recordMetric('error_rate', 1);
    expect(() => flushMetrics()).not.toThrow();
  });
});

describe('C.5-6 — PrometheusTextExporter', () => {
  it('renders TYPE + sample lines with labels, org, value and timestamp', () => {
    const exp = new PrometheusTextExporter();
    exp.export([
      point({ name: 'request_latency_ms', value: 250, organizationId: 'o1', labels: { route: '/x' } }),
      point({ name: 'write_success', value: 3 }),
    ]);
    const text = exp.render();
    expect(text).toContain('# TYPE request_latency_ms gauge');
    expect(text).toContain('# TYPE write_success counter');
    expect(text).toContain('request_latency_ms{organization_id="o1",route="/x"} 250 1791115200000');
    expect(text).toContain('write_success 3 1791115200000');
  });

  it('groups by metric name (sorted) and escapes label values', () => {
    const exp = new PrometheusTextExporter();
    exp.export([point({ name: 'error_rate', value: 0, labels: { note: 'a"b\\c' } })]);
    const text = exp.render();
    expect(text).toContain('# TYPE error_rate gauge');
    expect(text).toContain('note="a\\"b\\\\c"');
  });

  it('renders camelCase-ish label names as snake_case and empty buffer as empty string', () => {
    const exp = new PrometheusTextExporter();
    expect(exp.render()).toBe('');
    exp.export([point({ name: 'queue_depth', value: 1, labels: { providerName: 'meta' } })]);
    expect(exp.render()).toContain('provider_name="meta"');
  });
});

describe('C.5-6 — ConsoleLogExporter applies redaction', () => {
  it('redacts secret-looking label fields before logging', () => {
    const lines: string[] = [];
    const exp = new ConsoleLogExporter((line) => lines.push(line));
    exp.export([point({ labels: { api_key: 'sk-live-123', token: 'abc', route: '/ok' } })]);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.observability).toBe('metrics');
    expect(parsed.items[0].labels.api_key).toBe('[REDACTED]');
    expect(parsed.items[0].labels.token).toBe('[REDACTED]');
    expect(parsed.items[0].labels.route).toBe('/ok');
    expect(lines[0]).not.toContain('sk-live-123');
  });

  it('empty batch logs nothing', () => {
    const lines: string[] = [];
    new ConsoleLogExporter((line) => lines.push(line)).export([]);
    expect(lines).toHaveLength(0);
  });
});

describe('C.5-6 — OpenTelemetryExporter is a blocked-external buffering stub', () => {
  it('is marked BLOCKED_EXTERNAL and buffers without any network client', () => {
    const exp = new OpenTelemetryExporter('https://collector.example:4318');
    expect(exp.blockedExternal).toBe('OTLP_COLLECTOR_ENDPOINT');
    exp.export([point({ value: 9 })]);
    expect(exp.buffered().metrics).toHaveLength(1);
    expect(exp.buffered().spans).toHaveLength(0);
  });
});
