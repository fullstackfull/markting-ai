import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReportRow } from '@adport/core';

/**
 * PHASE A (A4) — direct coverage of gatherLive's read → partition → normalize → analyze → map wiring and
 * its honest NOT_CONNECTED degrade, using a MOCKED provider read (no live provider — not live verification).
 * Closes the "gatherLive untested" gap flagged in review.
 */
vi.mock('@/lib/cloud/reads', () => ({ readReportRows: vi.fn() }));
vi.mock('@/lib/markting/business-context', async (orig) => {
  const actual = await orig<typeof import('@/lib/markting/business-context')>();
  return { ...actual, loadBusinessContext: vi.fn(async (org: string) => actual.emptyBusinessContext(org)) };
});

import { readReportRows } from '@/lib/cloud/reads';
import { gatherLive } from '@/lib/cloud/live-gatherer';
import { resolveRange } from '@/lib/cloud/date-range';

const RANGE = resolveRange('last_30_days'); // UTC (no tz) — matches gatherLive when business tz is unset
const isCurrentWindow = (dr: unknown) => typeof dr === 'object' && dr !== null && (dr as { start: string }).start === RANGE.current.start;
const principal = { organizationId: 'org', userId: 'u', role: 'owner' as const, scopes: ['tools:read'] };
const curRows: ReportRow[] = [{ provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: 'c1', name: 'Prospecting' }, metrics: { spend: 10000, clicks: 2000, conversions: 50, conversion_value: 20000 } }];
const prevRows: ReportRow[] = [{ provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: 'c1', name: 'Prospecting' }, metrics: { spend: 10000, clicks: 2000, conversions: 200, conversion_value: 60000 } }];
const ok = (rows: ReportRow[]) => ({ ok: true as const, data: { rows, truncated: false }, connected: true, warnings: [] });

beforeEach(() => vi.mocked(readReportRows).mockReset());

describe('gatherLive', () => {
  it('reads live rows → computes media diagnoses; other domains honestly NOT_CONNECTED', async () => {
    vi.mocked(readReportRows).mockImplementation(async (_p, opts) => {
      if (opts?.level === 'campaign') return ok(isCurrentWindow(opts.dateRange) ? curRows : prevRows);
      return ok([]); // account level empty → falls back to campaign rows
    });
    const res = await gatherLive(principal, 'last_30_days');
    expect(res.provenance).toBe('LIVE');
    expect(res.connected).toBe(true);
    expect(res.rowsCurrent).toBe(1);
    const diagnoses = res.gathered.media?.diagnoses ?? [];
    expect(diagnoses.length).toBeGreaterThan(0);
    expect(diagnoses.some((d) => d.dataTrust === 'PLATFORM_REPORTED')).toBe(true);
    expect(res.gathered.availability?.COMMERCE).toBe('NOT_CONNECTED');
    expect(res.gathered.availability?.CREATIVE).toBe('NOT_CONNECTED');
  });

  it('degrades to the honest empty state when nothing is connected (never demo content)', async () => {
    vi.mocked(readReportRows).mockResolvedValue({ ok: true, data: { rows: [], truncated: false }, connected: false, warnings: [] });
    const res = await gatherLive(principal, 'last_7_days');
    expect(res.connected).toBe(false);
    expect(res.rowsCurrent).toBe(0);
    expect(res.gathered.media).toBeUndefined();
    expect(res.gathered.availability?.MEDIA).toBe('NOT_CONNECTED');
  });

  it('rejects invalid rows (no silent coercion) and still analyzes the valid remainder', async () => {
    const bad: ReportRow = { provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: 'bad', name: 'Bad' }, metrics: { spend: Number.NaN } };
    vi.mocked(readReportRows).mockImplementation(async (_p, opts) => (opts?.level === 'campaign' && isCurrentWindow(opts.dateRange) ? ok([...curRows, bad]) : ok([])));
    const res = await gatherLive(principal, 'last_30_days');
    expect(res.rejected.some((r) => r.entityId === 'bad')).toBe(true);
    expect(res.rowsCurrent).toBe(1); // only the valid row
  });
});
