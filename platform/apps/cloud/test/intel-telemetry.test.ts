import { describe, expect, it } from 'vitest';
import { emitIntelEvent, setIntelTelemetrySink, timed, type IntelEvent } from '@/lib/markting/ops/intel-telemetry';

/**
 * CODE-RC Program 29 — the intelligence telemetry hooks emit typed, secret-redacted events and never
 * break the request path.
 */
describe('intel telemetry', () => {
  it('emits events to an installed sink', () => {
    const seen: IntelEvent[] = [];
    const restore = setIntelTelemetrySink({ emit: (e) => seen.push(e) });
    try {
      emitIntelEvent({ kind: 'orchestrator_answer', organizationId: 'org-1', intent: 'DAILY_REVIEW', durationMs: 12, aiMode: 'DETERMINISTIC_ONLY', sourceType: 'SYNTHETIC', trustTier: 'SYNTHETIC' });
    } finally {
      restore();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'orchestrator_answer', intent: 'DAILY_REVIEW' });
  });

  it('redacts secret-looking fields before emitting', () => {
    const seen: Record<string, unknown>[] = [];
    const restore = setIntelTelemetrySink({ emit: (e) => seen.push(e as unknown as Record<string, unknown>) });
    try {
      // a (hypothetical) field that looks secret must be redacted by the shared redactor
      emitIntelEvent({ kind: 'provider_normalization_failure', provider: 'meta', reason: 'bad', access_token: 'EAAsecret' } as unknown as IntelEvent);
    } finally {
      restore();
    }
    expect(seen[0]!.access_token).toBe('[REDACTED]');
    expect(seen[0]!.provider).toBe('meta');
  });

  it('never throws into the caller even if the sink throws', () => {
    const restore = setIntelTelemetrySink({ emit: () => { throw new Error('sink down'); } });
    try {
      expect(() => emitIntelEvent({ kind: 'gather_duration', organizationId: 'o', durationMs: 1 })).not.toThrow();
    } finally {
      restore();
    }
  });

  it('timed() emits a duration event and returns the value', async () => {
    const seen: IntelEvent[] = [];
    const restore = setIntelTelemetrySink({ emit: (e) => seen.push(e) });
    try {
      const v = await timed(async () => 42, (ms) => ({ kind: 'gather_duration', organizationId: 'o', durationMs: ms }));
      expect(v).toBe(42);
    } finally {
      restore();
    }
    expect(seen[0]!.kind).toBe('gather_duration');
  });
});
