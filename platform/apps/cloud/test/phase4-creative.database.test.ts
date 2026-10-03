import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { upsertCreative, listCreatives, saveAnalysis, getAnalysis, saveCluster, saveSignal, rememberCreativePattern } from '@/lib/markting/creative/store';
import { listMemory } from '@/lib/markting/memory-store';
import type { Creative } from '@/lib/markting/creative/model';
import type { TenantPrincipal } from '@/lib/cloud/types';

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function creative(org: string, id: string): Creative {
  return { id, rawId: id.split(':').pop()!, provider: 'meta', organizationId: org, accountId: 'act_1', campaignId: 'camp_1', mediaType: 'image', status: 'ACTIVE', active: true, text: { headline: 'Buy now', cta: 'Shop now' }, assets: [{ assetId: 'as1', rawAssetId: 'as1', provider: 'meta', mediaType: 'image', contentHash: 'H1' }], performance: { currency: 'SAR', spend: 100, conversions: 10 }, trust: { tier: 'PLATFORM_REPORTED', source: 'meta-report', complete: true, currency: 'SAR', sampleSize: 10 } };
}

describeDatabase('Phase 4 creative store (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const users: string[] = [];
  let a: TenantPrincipal;
  let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`p4-${userId}@example.test`}, '{}'::jsonb)`;
      const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
      const p: TenantPrincipal = { organizationId: m!.organization_id, userId, role: 'owner', scopes: ['tools:read'] };
      if (i === 0) a = p; else b = p;
    }
  });
  afterAll(async () => {
    for (const userId of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${userId})`;
      await admin`delete from auth.users where id = ${userId}`;
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('creatives + assets are tenant-scoped; cross-tenant write rejected', async () => {
    const id = `meta:act_1:${randomUUID().slice(0, 8)}`;
    await upsertCreative(a.organizationId, creative(a.organizationId, id));
    expect((await listCreatives(a.organizationId)).length).toBe(1);
    expect((await listCreatives(b.organizationId)).length).toBe(0);
    await expect(upsertCreative(a.organizationId, creative(b.organizationId, id))).rejects.toThrow(/organization mismatch/);
  });

  it('analysis is versioned + insert-only (no silent overwrite); cache read works', async () => {
    const id = `meta:act_1:${randomUUID().slice(0, 8)}`;
    await upsertCreative(a.organizationId, creative(a.organizationId, id));
    expect((await saveAnalysis(a.organizationId, { creativeId: id, analysisType: 'visual', analysisVersion: 'v1', model: 'none', sourceHash: 'H1', result: { metadataOnly: true } })).stored).toBe(true);
    // Same version+hash is NOT overwritten.
    expect((await saveAnalysis(a.organizationId, { creativeId: id, analysisType: 'visual', analysisVersion: 'v1', model: 'none', sourceHash: 'H1', result: { metadataOnly: false } })).stored).toBe(false);
    expect((await getAnalysis(a.organizationId, id, 'visual', 'v1', 'H1') as { metadataOnly: boolean }).metadataOnly).toBe(true);
    // A new version coexists (history preserved).
    expect((await saveAnalysis(a.organizationId, { creativeId: id, analysisType: 'visual', analysisVersion: 'v2', model: 'm', sourceHash: 'H1', result: { metadataOnly: false } })).stored).toBe(true);
  });

  it('clusters + memberships + signals persist org-scoped', async () => {
    const id = `meta:act_1:${randomUUID().slice(0, 8)}`;
    await upsertCreative(a.organizationId, creative(a.organizationId, id));
    await saveCluster(a.organizationId, { clusterId: 'cluster:x', definingFeatures: ['media:image'], sampleSize: 10, performance: { spend: 100 }, creativeIds: [id] });
    await saveSignal(a.organizationId, { creativeId: id, kind: 'fatigue', state: 'WATCH', confidence: 'LOW', evidence: {} });
    const counted = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_creative_memberships where organization_id = ${a.organizationId}`;
    expect(Number(counted[0]?.count ?? 0)).toBe(1);
  });

  it('creative memory refuses a derived pattern from a tiny sample; accepts with enough', async () => {
    expect((await rememberCreativePattern(a.organizationId, { key: 'hook:product_first', value: { win: true }, sampleSize: 3, provenance: 'derived_analysis' })).ok).toBe(false);
    expect((await rememberCreativePattern(a.organizationId, { key: 'hook:product_first', value: { win: true }, sampleSize: 120, provenance: 'derived_analysis' })).ok).toBe(true);
    expect((await listMemory(a.organizationId, { category: 'historical_outcome' })).length).toBe(1);
    expect((await listMemory(b.organizationId, { category: 'historical_outcome' })).length).toBe(0);
  });
});
