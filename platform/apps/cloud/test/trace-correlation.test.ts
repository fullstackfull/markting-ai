import { describe, expect, it } from 'vitest';
import { TRACE_STAGES } from '@/lib/markting/ops/observability';
import {
  Tracer,
  correlate,
  correlationId,
  counterIdFactory,
  createRootContext,
  childContext,
  endSpan,
  startSpan,
  traceGovernedWrite,
} from '@/lib/markting/ops/trace-correlation';

/**
 * Phase C.6 (23) — trace correlation. Deterministic (injected clock + id factory), pure, secret-redacted;
 * builds a span tree across TRACE_STAGES and exposes the end-to-end critical path.
 */
const clockFrom = (startMs: number) => {
  let t = startMs;
  return { clock: () => new Date(t).toISOString(), advance: (ms: number) => { t += ms; } };
};

describe('C.6-23 — context propagation', () => {
  it('root has traceId+spanId and no parent; children keep traceId and chain parentId', () => {
    const nextId = counterIdFactory('id-');
    const root = createRootContext({ organizationId: 'o1', nextId });
    expect(root.parentId).toBeUndefined();
    expect(root.traceId).not.toBe(root.spanId);
    const child = childContext(root, nextId);
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentId).toBe(root.spanId);
    expect(child.organizationId).toBe('o1');
    const grandchild = childContext(child, nextId);
    expect(grandchild.parentId).toBe(child.spanId);
    expect(grandchild.traceId).toBe(root.traceId);
  });

  it('tenant-aware correlation id joins org + trace, and bare trace when no tenant', () => {
    expect(correlationId({ traceId: 'abc', organizationId: 'o1' })).toBe('o1:abc');
    expect(correlationId({ traceId: 'abc' })).toBe('abc');
  });
});

describe('C.6-23 — startSpan/endSpan', () => {
  it('stamps startedAt/endedAt from the injected clock and redacts attributes', () => {
    const { clock, advance } = clockFrom(1000);
    const ctx = createRootContext({ nextId: counterIdFactory() });
    const open = startSpan('analysis', ctx, { attributes: { stage: 'analysis', api_key: 'sk-live' }, clock });
    expect(open.span.startedAt).toBe(new Date(1000).toISOString());
    expect(open.span.endedAt).toBeUndefined();
    expect(open.span.attributes).toEqual({ stage: 'analysis', api_key: '[REDACTED]' });
    advance(250);
    const done = endSpan(open, { attributes: { outcome: 'ok', token: 'xyz' }, clock });
    expect(done.endedAt).toBe(new Date(1250).toISOString());
    expect(done.attributes).toEqual({ stage: 'analysis', api_key: '[REDACTED]', outcome: 'ok', token: '[REDACTED]' });
  });
});

describe('C.6-23 — Tracer + correlate build a tree with a critical path', () => {
  it('traces the governed-write pipeline: one root with a child per TRACE_STAGE', () => {
    const spans = traceGovernedWrite({ organizationId: 'o1', nextId: counterIdFactory() });
    expect(spans[0]!.name).toBe('governed_write');
    expect(spans.slice(1).map((s) => s.name)).toEqual([...TRACE_STAGES]);
    const c = correlate(spans);
    expect(c.roots).toHaveLength(1);
    expect(c.roots[0]!.span.name).toBe('governed_write');
    expect(c.roots[0]!.children.map((n) => n.span.name)).toEqual([...TRACE_STAGES]);
  });

  it('critical path is the root to the slowest stage with correct cumulative duration', () => {
    const durations = { analysis: 10, recommendation: 90, provider_write: 40 } as const;
    const spans = traceGovernedWrite({ nextId: counterIdFactory(), durations });
    const c = correlate(spans);
    // root duration envelops all stages (10+90+40 = 140); slowest stage is recommendation (90).
    expect(c.criticalPath[0]!.name).toBe('governed_write');
    expect(c.criticalPath[1]!.name).toBe('recommendation');
    expect(c.criticalPathMs).toBe(140 + 90);
  });

  it('spans with no in-set parent are roots; byId indexes by the span attribute id', () => {
    const nextId = counterIdFactory();
    const tracer = new Tracer({ nextId, clock: clockFrom(0).clock });
    const open = tracer.open('orphan');
    const done = tracer.close(open);
    // its parent (the root span) is NOT in the set → it becomes a root
    const c = correlate([done]);
    expect(c.roots).toHaveLength(1);
    expect(c.byId.get(done.attributes!.spanId!)!.span.name).toBe('orphan');
  });
});

describe('C.6-23 — deterministic given identical injections', () => {
  it('two runs with the same id factory + durations produce identical span sets', () => {
    const a = traceGovernedWrite({ organizationId: 'o1', nextId: counterIdFactory('x'), durations: { approval: 5 } });
    const b = traceGovernedWrite({ organizationId: 'o1', nextId: counterIdFactory('x'), durations: { approval: 5 } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
