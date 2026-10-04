import { describe, expect, it } from 'vitest';
import { ALERT_TYPES, ingestAlert, resolveAlert, dedupKey, type AlertInput, type AlertRecord } from '@/lib/markting/ops/alerts';
import { InMemoryAlertStore } from '@/lib/markting/ops/alert-store';
import { processAlert, PlatformAdminChannel, type AlertChannel } from '@/lib/markting/ops/alert-delivery';

const NOW = 3_000_000;
const COOLDOWN = 10 * 60_000;
const input: AlertInput = { type: 'PROVIDER_OUTAGE', source: 'sync-worker', provider: 'meta', evidence: { code: 503 } };

describe('C.5-4 — alert pipeline', () => {
  it('has the 11 canonical alert types', () => {
    expect(ALERT_TYPES).toHaveLength(11);
    expect(ALERT_TYPES).toContain('SECURITY_INCIDENT');
    expect(ALERT_TYPES).toContain('AI_COST_ANOMALY');
  });

  it('a new alert opens, delivers, and carries properties + correlation id', () => {
    const d = ingestAlert(null, input, NOW, COOLDOWN, () => 'corr-1');
    expect(d.deliver).toBe(true);
    expect(d.record).toMatchObject({ type: 'PROVIDER_OUTAGE', severity: 'CRITICAL', state: 'OPEN', count: 1, correlationId: 'corr-1', provider: 'meta' });
    expect(d.record.firstSeenAtMs).toBe(NOW);
  });

  it('a repeat within cooldown is suppressed (anti-storm): count++, no deliver', () => {
    const first = ingestAlert(null, input, NOW, COOLDOWN).record;
    const second = ingestAlert(first, input, NOW + 60_000, COOLDOWN);
    expect(second.deliver).toBe(false);
    expect(second.record.count).toBe(2);
    expect(second.record.state).toBe('COOLDOWN');
  });

  it('a repeat after cooldown reopens and re-delivers', () => {
    const first = ingestAlert(null, input, NOW, COOLDOWN).record;
    const later = ingestAlert(first, input, NOW + COOLDOWN + 1, COOLDOWN);
    expect(later.deliver).toBe(true);
    expect(later.record.state).toBe('OPEN');
    expect(later.record.count).toBe(2);
  });

  it('after RESOLVED, a new signal reopens with a FRESH correlation id', () => {
    const first = ingestAlert(null, input, NOW, COOLDOWN, () => 'corr-A').record;
    const resolved = resolveAlert(first);
    const reopened = ingestAlert(resolved, input, NOW + 1000, COOLDOWN, () => 'corr-B');
    expect(reopened.deliver).toBe(true);
    expect(reopened.record.correlationId).toBe('corr-B');
  });

  it('dedupKey collapses same type+org+provider+source', () => {
    expect(dedupKey(input)).toBe(dedupKey({ ...input, evidence: { other: 1 } } as AlertInput));
  });

  it('processAlert delivers once, suppresses within cooldown, and a failing channel never blocks', async () => {
    const store = new InMemoryAlertStore();
    const bad: AlertChannel = { name: 'bad', deliver: async () => { throw new Error('down'); } };
    const good = new PlatformAdminChannel();
    const r1 = await processAlert(store, [bad, good], input, NOW, COOLDOWN);
    expect(r1.delivered).toBe(true);
    expect(r1.channels).toContain('platform_admin'); // good ran despite bad throwing
    const r2 = await processAlert(store, [good], input, NOW + 60_000, COOLDOWN);
    expect(r2.delivered).toBe(false); // within cooldown
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.count).toBe(2);
  });

  it('delivered alert record has the required properties', async () => {
    const store = new InMemoryAlertStore();
    const r = await processAlert(store, [new PlatformAdminChannel()], input, NOW, COOLDOWN);
    const rec: AlertRecord = r.record;
    for (const k of ['type', 'severity', 'source', 'dedupKey', 'correlationId', 'state', 'count', 'firstSeenAtMs', 'lastSeenAtMs'] as const) {
      expect(rec[k]).toBeDefined();
    }
  });
});
