import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ingestWebhookRequest,
  type IngressDeps, type ResolvedConnection, type DedupStore, type SyncEnqueuePort,
} from '@/lib/markting/commerce/webhook-ingress';
import type { EnqueueInput } from '@/lib/markting/ops/sync-store';

/**
 * PHASE C.5 (3) — WEBHOOK INGRESS security pipeline, proven over injected ports with NO live transport
 * and NO real provider secret. A known HMAC secret crafts valid signatures; every denial path, the
 * tenant-from-connection invariant, dedup, the replay window, the body cap, and dead-lettering are
 * exercised deterministically.
 */

const SECRET = 'whsec_test_known_secret';
const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const ORG = 'org-trusted-11111111';
const CONN = 'conn-aaaaaaaa';

/** Case-insensitive header getter from a plain map (mirrors Web `Headers`). */
function headers(map: Record<string, string>) {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower.get(name.toLowerCase()) ?? null;
}

function shopifySig(rawBody: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}
function stripeHeader(rawBody: string, t: number, secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/** In-memory dedup. */
function memDedup(): DedupStore & { calls: string[] } {
  const seen = new Set<string>();
  const calls: string[] = [];
  return {
    calls,
    async seen(connectionId, eventId) { return seen.has(`${connectionId}|${eventId}`); },
    async record(connectionId, eventId) { calls.push(`${connectionId}|${eventId}`); seen.add(`${connectionId}|${eventId}`); },
  };
}

/** Enqueue spy. */
function enqueueSpy(impl?: (i: EnqueueInput) => Promise<unknown>): SyncEnqueuePort & { inputs: EnqueueInput[] } {
  const inputs: EnqueueInput[] = [];
  return {
    inputs,
    async enqueue(input) { inputs.push(input); return impl ? impl(input) : undefined; },
  };
}

function conn(over: Partial<ResolvedConnection> = {}): ResolvedConnection {
  return {
    connectionId: CONN,
    organizationId: ORG,
    provider: 'shopify',
    active: true,
    signingSecret: SECRET,
    ...over,
  };
}

function deps(over: Partial<IngressDeps> = {}): IngressDeps {
  return {
    resolveConnection: async () => conn(),
    dedup: memDedup(),
    enqueue: enqueueSpy(),
    now: NOW,
    ...over,
  };
}

/** A valid shopify delivery (body + matching headers). */
function shopifyDelivery(opts: { body?: string; secret?: string; triggeredAt?: string; eventId?: string } = {}) {
  const body = opts.body ?? JSON.stringify({ id: 9001, email: 'a@b.com', total_price: '10.00' });
  return {
    body,
    get: headers({
      'x-shopify-hmac-sha256': shopifySig(body, opts.secret ?? SECRET),
      'x-shopify-topic': 'orders/create',
      'x-shopify-triggered-at': opts.triggeredAt ?? new Date(NOW).toISOString(),
      'x-shopify-webhook-id': opts.eventId ?? 'evt-shopify-1',
    }),
  };
}

describe('C.5(3) — webhook ingress', () => {
  it('accepts a valid signature and enqueues a WEBHOOK_TRIGGERED sync', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ enqueue });
    const { body, get } = shopifyDelivery();
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('ACCEPTED');
    expect(res.httpStatus).toBe(200);
    expect(res.organizationId).toBe(ORG);
    expect(enqueue.inputs).toHaveLength(1);
    expect(enqueue.inputs[0]).toMatchObject({ organizationId: ORG, provider: 'shopify', syncType: 'WEBHOOK_TRIGGERED' });
    expect(enqueue.inputs[0]!.idempotencyKey).toBe('webhook:shopify:evt-shopify-1');
  });

  it('denies an invalid signature (no enqueue)', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ enqueue });
    const { body, get } = shopifyDelivery({ secret: 'wrong-secret' });
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('INVALID_SIGNATURE');
    expect(res.httpStatus).toBe(401);
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('denies an expired timestamp (outside the replay window)', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ enqueue });
    const stale = new Date(NOW - 10 * 60_000).toISOString(); // 10 min old, window is 5 min
    const { body, get } = shopifyDelivery({ triggeredAt: stale });
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('EXPIRED_TIMESTAMP');
    expect(res.httpStatus).toBe(400);
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('dedupes a replayed / duplicate event', async () => {
    const dedup = memDedup();
    const enqueue = enqueueSpy();
    const d = deps({ dedup, enqueue });
    const { body, get } = shopifyDelivery();
    const first = await ingestWebhookRequest('shopify', CONN, get, body, d);
    const second = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(first.outcome).toBe('ACCEPTED');
    expect(second.outcome).toBe('DUPLICATE');
    expect(second.httpStatus).toBe(409);
    expect(enqueue.inputs).toHaveLength(1); // only the first enqueued
  });

  it('denies an unknown connection', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ resolveConnection: async () => null, enqueue });
    const { body, get } = shopifyDelivery();
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('UNKNOWN_CONNECTION');
    expect(res.organizationId).toBeUndefined();
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('denies a disabled (inactive) connection even with a valid signature', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ resolveConnection: async () => conn({ active: false }), enqueue });
    const { body, get } = shopifyDelivery();
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('DISABLED_CONNECTION');
    expect(res.httpStatus).toBe(403);
    expect(res.organizationId).toBe(ORG);
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('reports NOT_CONFIGURED honestly when the connection has no signing secret', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ resolveConnection: async () => conn({ signingSecret: null }), enqueue });
    const { body, get } = shopifyDelivery();
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('NOT_CONFIGURED');
    expect(res.httpStatus).toBe(503);
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('NEVER lets a wrong-tenant payload override the connection-derived org', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ enqueue });
    // Payload claims a DIFFERENT org/store — must be ignored; resolved org wins.
    const body = JSON.stringify({ id: 42, organization_id: 'org-ATTACKER', store_id: 'evil-store' });
    const get = headers({
      'x-shopify-hmac-sha256': shopifySig(body),
      'x-shopify-topic': 'orders/create',
      'x-shopify-triggered-at': new Date(NOW).toISOString(),
      'x-shopify-webhook-id': 'evt-xtenant',
    });
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('ACCEPTED');
    expect(res.organizationId).toBe(ORG);
    expect(enqueue.inputs[0]!.organizationId).toBe(ORG); // not org-ATTACKER
  });

  it('denies an unsupported (non-allowlisted) event type', async () => {
    const enqueue = enqueueSpy();
    const d = deps({ enqueue });
    const body = JSON.stringify({ id: 1 });
    const get = headers({
      'x-shopify-hmac-sha256': shopifySig(body),
      'x-shopify-topic': 'carts/create', // not on the allowlist
      'x-shopify-triggered-at': new Date(NOW).toISOString(),
      'x-shopify-webhook-id': 'evt-unknown-topic',
    });
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('UNSUPPORTED_EVENT');
    expect(res.httpStatus).toBe(400);
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('denies an oversized body before any processing', async () => {
    const enqueue = enqueueSpy();
    const resolveConnection = vi.fn(async () => conn());
    const d = deps({ enqueue, resolveConnection, maxBodyBytes: 1024 });
    const big = 'x'.repeat(2048);
    const get = headers({ 'x-shopify-hmac-sha256': 'irrelevant', 'x-shopify-topic': 'orders/create' });
    const res = await ingestWebhookRequest('shopify', CONN, get, big, d);
    expect(res.outcome).toBe('BODY_TOO_LARGE');
    expect(res.httpStatus).toBe(413);
    expect(resolveConnection).not.toHaveBeenCalled();
    expect(enqueue.inputs).toHaveLength(0);
  });

  it('dead-letters when downstream processing (enqueue) fails', async () => {
    const deadLetter = vi.fn<NonNullable<IngressDeps['deadLetter']>>(async () => {});
    const enqueue = enqueueSpy(async () => { throw new Error('queue unavailable'); });
    const d = deps({ enqueue, deadLetter });
    const { body, get } = shopifyDelivery();
    const res = await ingestWebhookRequest('shopify', CONN, get, body, d);
    expect(res.outcome).toBe('DEAD_LETTER');
    expect(res.httpStatus).toBe(500);
    expect(deadLetter).toHaveBeenCalledTimes(1);
    expect(deadLetter.mock.calls[0]![0]).toMatchObject({ organizationId: ORG, provider: 'shopify', error: 'queue unavailable' });
  });

  it('denies an unsupported provider', async () => {
    const res = await ingestWebhookRequest('bigcommerce', CONN, headers({}), '{}', deps());
    expect(res.outcome).toBe('UNSUPPORTED_PROVIDER');
    expect(res.httpStatus).toBe(404);
  });

  it('verifies a stripe (billing) webhook but does NOT enqueue a commerce sync', async () => {
    const enqueue = enqueueSpy();
    const t = Math.floor(NOW / 1000);
    const body = JSON.stringify({ id: 'evt_stripe_1', type: 'payment_intent.succeeded' });
    const d = deps({ enqueue, resolveConnection: async () => conn({ provider: 'stripe' }) });
    const get = headers({ 'stripe-signature': stripeHeader(body, t) });
    const res = await ingestWebhookRequest('stripe', CONN, get, body, d);
    expect(res.outcome).toBe('ACCEPTED');
    expect(enqueue.inputs).toHaveLength(0); // stripe is not a commerce platform
  });

  it('accepts a salla delivery with a hex signature and body-sourced topic/timestamp', async () => {
    const enqueue = enqueueSpy();
    const body = JSON.stringify({ event: 'order.created', created_at: new Date(NOW).toISOString(), data: { id: 7 } });
    const hex = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    const d = deps({ enqueue, resolveConnection: async () => conn({ provider: 'salla' }) });
    const get = headers({ 'x-salla-signature': hex, 'x-salla-webhook-id': 'evt-salla-1' });
    const res = await ingestWebhookRequest('salla', CONN, get, body, d);
    expect(res.outcome).toBe('ACCEPTED');
    expect(enqueue.inputs[0]).toMatchObject({ provider: 'salla', syncType: 'WEBHOOK_TRIGGERED' });
  });
});
