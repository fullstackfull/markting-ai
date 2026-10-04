import { describe, expect, it, beforeAll } from 'vitest';

/**
 * PHASE B — exercise the EXACT loader the campaign page uses (loadAdGroupList) in DEMO mode, to prove
 * the ad-group table is populated for the drill-chain's campaign (the E2E-14 target). Isolates a
 * loader/runtime-gate issue from the pure seed-data path (seed-hierarchy.test.ts).
 */
beforeAll(() => {
  process.env.MARKTING_DEMO_MODE = 'true';
  process.env.MARKTING_RUNTIME_MODE = 'DEMO';
});

const ACC = 'sandbox:acc:ramadan';
const CAMP = 'sandbox:acc:ramadan:camp:awareness';
const tenant = { organizationId: 'org', userId: 'u', role: 'owner' as const } as never;

describe('loadAdGroupList (the campaign-page loader) in DEMO', () => {
  it('returns OK with ad-group rows for the awareness campaign', async () => {
    const { loadAdGroupList } = await import('@/lib/cloud/intelligence');
    const res = await loadAdGroupList(tenant, ACC, CAMP);
    expect(res.state).toBe('OK');
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.providerId).toBeTruthy();
  });

  it('the full campaign-page loader set resolves without throwing (no sibling loader takes the page down)', async () => {
    const { loadCampaign, loadSection, loadAdGroupList } = await import('@/lib/cloud/intelligence');
    const [section, outcomes, groups] = await Promise.all([
      loadCampaign(tenant, ACC, CAMP),
      loadSection(tenant, 'OUTCOMES_HISTORY', { locale: 'en', accountId: ACC }, 'last_30_days'),
      loadAdGroupList(tenant, ACC, CAMP),
    ]);
    expect(section).toBeTruthy();
    expect(outcomes).toBeTruthy();
    expect(groups.state).toBe('OK');
  });
});
