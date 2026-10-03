import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import {
  upsertStoreConnection, upsertOrders, upsertRefunds, listOrderRows, saveProductCost, loadCostBook,
  dbSyncStore, dbWebhookPorts, saveProfitabilityConfig, loadProfitabilityConfig,
} from '@/lib/markting/commerce/store';
import { ingestWebhook } from '@/lib/markting/commerce/webhooks';
import { createHmac } from 'node:crypto';
import type { Order, Refund } from '@/lib/markting/commerce/model';
import type { TenantPrincipal } from '@/lib/cloud/types';

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function order(org: string, id: string): Order {
  return {
    orderId: `salla:s1:${id}`, organizationId: org, storeId: 'salla:s1', platform: 'salla', externalOrderId: id,
    createdAt: '2026-09-10T00:00:00.000Z', paidAt: '2026-09-10T00:00:00.000Z', currency: 'SAR',
    subtotal: { minorUnits: 10000, currency: 'SAR' }, grossTotal: { minorUnits: 10000, currency: 'SAR' },
    stage: 'paid', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
    customer: { pseudoId: 'cust-1', classification: 'new', identityConfidence: 'KNOWN' },
    lines: [{ lineId: 'l1', sku: 'SKU1', title: 'thing', quantity: 1, unitPrice: { minorUnits: 10000, currency: 'SAR' } }],
    provenance: { platform: 'salla', sourceId: id, origin: 'connector_read', tiers: ['PLATFORM_ORDER', 'PAID_ORDER'] },
  };
}

describeDatabase('Phase 5 commerce store (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const users: string[] = [];
  let a: TenantPrincipal; let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`p5-${userId}@example.test`}, '{}'::jsonb)`;
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

  it('orders + lines are tenant-scoped; cross-tenant write rejected before DB', async () => {
    await upsertStoreConnection(a.organizationId, { connectionId: `conn-${a.organizationId}`, storeId: 'salla:s1', platform: 'salla', signingSecretRef: 'secret-A' });
    await upsertOrders(a.organizationId, [order(a.organizationId, 'o1')]);
    expect((await listOrderRows(a.organizationId)).length).toBe(1);
    expect((await listOrderRows(b.organizationId)).length).toBe(0);
    await expect(upsertOrders(a.organizationId, [order(b.organizationId, 'o2')])).rejects.toThrow(/organization mismatch/);
  });

  it('order upsert is idempotent (re-sync replaces, never doubles)', async () => {
    await upsertOrders(a.organizationId, [order(a.organizationId, 'dup')]);
    await upsertOrders(a.organizationId, [order(a.organizationId, 'dup')]);
    const lines = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_order_lines where organization_id = ${a.organizationId} and order_id = 'salla:s1:dup'`;
    expect(Number(lines[0]?.count ?? 0)).toBe(1); // lines replaced, not duplicated
  });

  it('refunds persist org-scoped', async () => {
    const r: Refund = { refundId: 'salla:rf1', orderId: 'salla:s1:o1', organizationId: a.organizationId, storeId: 'salla:s1', platform: 'salla', externalRefundId: 'rf1', amount: { minorUnits: 3000, currency: 'SAR' }, kind: 'partial', refundedAt: '2026-09-12', provenance: { platform: 'salla', sourceId: 'rf1', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] } };
    await upsertRefunds(a.organizationId, [r]);
    const rows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_refunds where organization_id = ${a.organizationId}`;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('cost book loads the latest-effective cost per product_ref', async () => {
    await saveProductCost(a.organizationId, { sku: 'SKU1', unitCost: { minorUnits: 4000, currency: 'SAR' }, provenance: { platform: 'salla', sourceId: 'SKU1', origin: 'merchant_config', tiers: ['COST_CONFIGURED'] } });
    const book = await loadCostBook(a.organizationId);
    expect(book.unitCost({ sku: 'SKU1' })!.unitCost.minorUnits).toBe(4000);
  });

  it('sync checkpoint persists + resumes; webhook dedup via commerce_events', async () => {
    const store = dbSyncStore();
    await store.saveCheckpoint({ connectionId: `conn-${a.organizationId}`, organizationId: a.organizationId, platform: 'salla', cursor: 'c2', highWater: '2026-09-20T00:00:00.000Z', status: 'idle', consecutiveErrors: 0 });
    const cp = await store.getCheckpoint(`conn-${a.organizationId}`);
    expect(cp!.cursor).toBe('c2');

    const secret = 'secret-A';
    const rawBody = JSON.stringify({ topic: 'orders/create', organization_id: 'org-EVIL' });
    const signature = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    const env = { connectionId: `conn-${a.organizationId}`, platform: 'salla' as const, externalEventId: 'evt-1', topic: 'orders/create', signature, timestamp: new Date().toISOString(), rawBody };
    const first = await ingestWebhook(env, dbWebhookPorts());
    expect(first.accepted).toBe(true);
    expect(first.organizationId).toBe(a.organizationId); // server-resolved org, not payload org
    const second = await ingestWebhook(env, dbWebhookPorts());
    expect(second.reason).toBe('DUPLICATE');
  });

  it('profitability config is insert-only history (traceable)', async () => {
    await saveProfitabilityConfig(a.organizationId, { targets: { targetMer: { basis: 'net', value: 3 } }, source: 'human_config' });
    const cfg = await loadProfitabilityConfig(a.organizationId);
    expect(cfg).toBeTruthy();
    expect((cfg as { targets: { targetMer: { value: number } } }).targets.targetMer.value).toBe(3);
  });
});
