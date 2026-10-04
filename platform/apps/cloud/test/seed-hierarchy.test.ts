import { describe, expect, it } from 'vitest';
import { seedClientForAccount } from '@/lib/markting/orchestrator/seed';
import { buildCampaign, buildAdGroup, buildAd, buildCampaignRows } from '@/lib/markting/orchestrator/sections';

/**
 * PHASE B (B2/B30) — the DEMO seed hierarchy that the drill-down surfaces read. Guards that the demo
 * campaign the E2E drill-chain uses actually exposes ad groups + ads (so the campaign page renders group
 * links), and that parent-child lookup is nested (a mismatched tuple is not found).
 */
const ACC = 'sandbox:acc:ramadan';
const CAMP = 'sandbox:acc:ramadan:camp:awareness';
const GROUP = 'sandbox:acc:ramadan:camp:awareness:ag:lanterns';

describe('DEMO seed hierarchy for the drill-down chain', () => {
  it('resolves the ramadan account', () => {
    expect(seedClientForAccount(ACC).account.accountId).toBe(ACC);
  });
  it('the awareness campaign exposes ad groups (campaign page renders group links)', () => {
    const section = buildCampaign(seedClientForAccount(ACC).account, CAMP);
    expect(section.adGroups && section.adGroups.length).toBeGreaterThan(0);
    expect(section.adGroups!.some((g) => g.id === GROUP)).toBe(true);
  });
  it('the lanterns ad group exposes ads (group page renders ad links)', () => {
    const g = buildAdGroup(seedClientForAccount(ACC).account, CAMP, GROUP);
    expect(g.found).toBe(true);
    expect(g.ads && g.ads.length).toBeGreaterThan(0);
    expect(g.name).toMatch(/Lanterns/); // the group-detail page renders this
  });
  it('a seeded ad resolves with its name (ad detail page renders real content)', () => {
    const AD = 'sandbox:acc:ramadan:camp:awareness:ag:lanterns:ad:video-a';
    const ad = buildAd(seedClientForAccount(ACC).account, CAMP, GROUP, AD);
    expect(ad.found).toBe(true);
    expect(ad.name).toMatch(/Lantern Video A/);
  });
  it('a group id under the wrong campaign is not found (nested ownership)', () => {
    const g = buildAdGroup(seedClientForAccount(ACC).account, 'sandbox:acc:ramadan:camp:brandsearch', GROUP);
    expect(g.found).toBe(false);
  });
  it('the account campaigns table lists the awareness campaign', () => {
    const rows = buildCampaignRows(seedClientForAccount(ACC).account);
    expect(rows.some((r) => r.id === CAMP)).toBe(true);
  });
});
