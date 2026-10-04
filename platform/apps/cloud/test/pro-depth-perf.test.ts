import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows } from '@/lib/markting/intelligence/normalize';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { emptyBusinessContext } from '@/lib/markting/business-context';
import { parseTableState, applyTableState, type TableColumnSpec } from '@/lib/cloud/table-state';

/**
 * PHASE B (B19) — bounded, roughly-linear performance for the depth + table work at 100 / 1,000 /
 * 10,000 entities. All of this is in-memory compute over data already read (no per-row DB query → no
 * N+1); these tests assert it stays well under a generous wall-clock bound and never duplicates/loses
 * entities. The absolute numbers are loose (CI shared runners) — the point is the absence of a
 * quadratic blow-up between 1k and 10k.
 */
const PERIOD = { current: { start: '2026-09-28', end: '2026-10-04' }, previous: { start: '2026-09-21', end: '2026-09-27' } };
const norm = (r: ReportRow[], range: { start: string; end: string }) =>
  normalizeReportRows(r, { tier: 'PLATFORM_REPORTED', dateRange: range, windowComplete: true, readAt: '2026-10-04T06:00:00.000Z' });

/** A full campaign→ad_group→ad tree with `campaigns` campaigns, `groups` ad groups each, `ads` ads each. */
function tree(campaigns: number, groups: number, ads: number, period: 'cur' | 'prev') {
  const conv = period === 'cur' ? 20 : 30;
  const camp: ReportRow[] = [], grp: ReportRow[] = [], ad: ReportRow[] = [];
  for (let c = 0; c < campaigns; c++) {
    const cid = `c${c}`;
    camp.push({ provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: cid, name: `Campaign ${c}` }, metrics: { spend: 1000, clicks: 200, conversions: conv, conversion_value: 3000 } });
    for (let g = 0; g < groups; g++) {
      const gid = `${cid}-ag${g}`;
      grp.push({ provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'ad_group', id: gid, name: `Ad set ${c}.${g}`, parentId: cid, entityType: 'adset' }, metrics: { spend: 500, clicks: 100, conversions: conv / 2, conversion_value: 1500 } });
      for (let a = 0; a < ads; a++) {
        grp.length; // no-op to keep structure explicit
        ad.push({ provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'ad', id: `${gid}-ad${a}`, name: `Ad ${c}.${g}.${a}`, parentId: gid, entityType: 'ad' }, metrics: { spend: 250, clicks: 50, conversions: conv / 4, conversion_value: 750 } });
      }
    }
  }
  return { camp, grp, ad };
}

describe.each([
  { campaigns: 10, groups: 5, ads: 2, label: '100 entities' },
  { campaigns: 50, groups: 10, ads: 2, label: '~1k entities' },
  { campaigns: 100, groups: 10, ads: 9, label: '~10k entities' },
])('hierarchy analyze scales: $label', ({ campaigns, groups, ads }) => {
  it('descends campaign→group→ad within a bounded time, no duplicate/lost entities', () => {
    const cur = tree(campaigns, groups, ads, 'cur');
    const prev = tree(campaigns, groups, ads, 'prev');
    const t0 = Date.now();
    const intel = analyzeAccount({
      engineContext: { organizationId: 'org', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD,
      currentAccount: norm(cur.camp, PERIOD.current), previousAccount: norm(prev.camp, PERIOD.previous),
      currentCampaigns: norm(cur.camp, PERIOD.current), previousCampaigns: norm(prev.camp, PERIOD.previous),
      currentAdGroups: norm(cur.grp, PERIOD.current), previousAdGroups: norm(prev.grp, PERIOD.previous),
      currentAds: norm(cur.ad, PERIOD.current), previousAds: norm(prev.ad, PERIOD.previous),
      business: emptyBusinessContext('org'),
    });
    const ms = Date.now() - t0;
    expect(intel.campaigns).toHaveLength(campaigns);
    const groupNodes = intel.campaigns.flatMap((c) => c.children ?? []);
    expect(groupNodes).toHaveLength(campaigns * groups);
    const adNodes = groupNodes.flatMap((g) => g.children ?? []);
    expect(adNodes).toHaveLength(campaigns * groups * ads);
    // No duplicate entity ids across the ad level.
    expect(new Set(adNodes.map((a) => a.entityId)).size).toBe(campaigns * groups * ads);
    expect(ms, `analyze ${campaigns * groups * ads} ads in ${ms}ms`).toBeLessThan(8000);
  });
});

describe.each([100, 1000, 10000])('AnalyticsTable state scales at %i rows', (n) => {
  interface Row { name: string; spend: number }
  const specs: Array<TableColumnSpec<Row>> = [
    { key: 'name', sortValue: (r) => r.name, searchText: (r) => r.name },
    { key: 'spend', numeric: true, sortValue: (r) => r.spend },
  ];
  it('filters + sorts + paginates within a bounded time and returns one bounded page', () => {
    const rows: Row[] = Array.from({ length: n }, (_, i) => ({ name: `Entity ${i}`, spend: (i * 7919) % 100000 }));
    const state = parseTableState({ sort: 'spend', dir: 'desc', q: 'Entity', page: '3' }, { allowedSorts: ['spend', 'name'], pageSize: 25 });
    const t0 = Date.now();
    const page = applyTableState(rows, state, specs);
    const ms = Date.now() - t0;
    expect(page.filtered).toBe(n); // all match "Entity"
    expect(page.rows.length).toBeLessThanOrEqual(25); // bounded page, never the full table
    expect(ms, `table of ${n} in ${ms}ms`).toBeLessThan(2000);
  });
});
