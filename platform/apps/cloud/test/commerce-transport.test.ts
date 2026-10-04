import { describe, expect, it } from 'vitest';
import {
  FakeCommerceTransport, BlockedHttpCommerceTransport, BlockedExternalError, BLOCKED_EXTERNAL_MARKER,
  COMMERCE_TRANSPORT_DESCRIPTORS, COMMERCE_READ_RESOURCES, isReadResource, transportPageSource,
  type CommerceReadResource,
} from '@/lib/markting/commerce/transport';
import { paginate } from '@/lib/markting/ops/provider-pagination';
import { COMMERCE_PLATFORMS } from '@/lib/markting/commerce/model';

describe('ITEM 11 — commerce transport port', () => {
  it('ships a DOCUMENTATION_DERIVED descriptor for every platform (shapes only, no secrets)', () => {
    for (const p of COMMERCE_PLATFORMS) {
      const d = COMMERCE_TRANSPORT_DESCRIPTORS[p];
      expect(d.platform).toBe(p);
      expect(d.source).toBe('DOCUMENTATION_DERIVED');
      expect(d.basePathShape).toContain('{resource}');
      expect(d.authHeaderName.length).toBeGreaterThan(0);
    }
  });

  it('is read-only by construction: only read resources are representable', () => {
    expect([...COMMERCE_READ_RESOURCES]).toEqual(['stores', 'orders', 'products', 'refunds', 'inventory']);
    expect(isReadResource('orders')).toBe(true);
    expect(isReadResource('create')).toBe(false);
    expect(isReadResource('delete')).toBe(false);
  });

  it('FakeCommerceTransport returns a page of raw records and classifies FIXTURE_PROVEN', async () => {
    const t = new FakeCommerceTransport('shopify', { orders: [{ id: '1' }, { id: '2' }] });
    expect(t.classification).toBe('FIXTURE_PROVEN');
    const page = await t.fetchPage({ connectionId: 'c', resource: 'orders', limit: 50 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('FakeCommerceTransport paginates deterministically via a cursor', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
    const t = new FakeCommerceTransport('salla', { orders: rows });
    const first = await t.fetchPage({ connectionId: 'c', resource: 'orders', limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBe('2');
    const second = await t.fetchPage({ connectionId: 'c', resource: 'orders', cursor: first.nextCursor, limit: 2 });
    expect((second.rows[0] as { id: string }).id).toBe('2');
    const third = await t.fetchPage({ connectionId: 'c', resource: 'orders', cursor: second.nextCursor, limit: 2 });
    expect(third.rows).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
  });

  it('drives provider-pagination `paginate` over a transport (cursor traversal reused, not reimplemented)', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }));
    const t = new FakeCommerceTransport('zid', { orders: rows });
    const src = transportPageSource(t, { connectionId: 'c', resource: 'orders', limit: 3 });
    const result = await paginate(src, { maxPages: 100, maxRows: 1000 });
    expect(result.stop).toBe('COMPLETE');
    expect(result.rows).toHaveLength(7);
    expect(result.resumeCursor).toBeNull();
  });

  it('BlockedHttpCommerceTransport implements the port but refuses every call (BLOCKED_EXTERNAL)', async () => {
    const t = new BlockedHttpCommerceTransport('woocommerce');
    expect(t.classification).toBe('BLOCKED_EXTERNAL');
    // Descriptor is still available (documentation metadata), but no network client exists.
    expect(t.descriptor().platform).toBe('woocommerce');
    await expect(t.fetchPage({ connectionId: 'c', resource: 'orders', limit: 10 })).rejects.toBeInstanceOf(BlockedExternalError);
    try {
      await t.fetchPage({ connectionId: 'c', resource: 'orders' as CommerceReadResource, limit: 10 });
    } catch (e) {
      expect((e as BlockedExternalError).marker).toBe(BLOCKED_EXTERNAL_MARKER);
    }
  });
});
