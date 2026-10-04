import { recordConnectionEvent } from '@/lib/connections/events';
import { PostgresSyncQueue } from '@/lib/markting/ops/sync-store';
import {
  ingestWebhookRequest, createPostgresResolveConnection, createPostgresDedupStore,
  type IngressDeps, type WebhookAuditEvent,
} from '@/lib/markting/commerce/webhook-ingress';

/**
 * PHASE C.5 (3) — WEBHOOK INGRESS route. One handler for every supported provider
 * (shopify / woocommerce / salla / zid / stripe), dispatched by the `[provider]` dynamic segment.
 *
 * NOTE: this is the MODIFIED Next — `params` is a Promise and MUST be awaited.
 *
 * The connection the delivery is addressed to is read from the `connection` query param (or the
 * `x-adport-connection-id` header). That id is only an addressing hint: trust comes from the HMAC
 * verification against THAT connection's secret inside webhook-ingress. The organization is ALWAYS
 * derived from the trusted connection record — NEVER from any field in the untrusted payload.
 *
 * Responses never leak internal detail: an opaque {ok}/{error} plus the mapped status code.
 */

/** recordConnectionEvent-backed audit: the accepted trigger is a real lifecycle event; the rest log. */
async function recordAudit(event: WebhookAuditEvent): Promise<void> {
  if (event.outcome === 'ACCEPTED') {
    await recordConnectionEvent({
      organizationId: event.organizationId,
      connectionId: event.connectionId,
      provider: event.provider,
      connectionType: 'commerce',
      event: 'sync_triggered',
      actorType: 'system',
      reason: 'webhook',
      detail: { topic: event.topic ?? null, externalEventId: event.externalEventId ?? null },
    });
    return;
  }
  // Denials / not-configured / dead-letter: a secret-free structured trail (no connection_events row).
  console.warn('[webhook-route] rejected', {
    provider: event.provider, outcome: event.outcome, organizationId: event.organizationId,
    connectionId: event.connectionId, topic: event.topic,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await request.text();

  const connectionId =
    new URL(request.url).searchParams.get('connection') ?? request.headers.get('x-adport-connection-id');

  const deps: IngressDeps = {
    resolveConnection: createPostgresResolveConnection(),
    dedup: createPostgresDedupStore(),
    enqueue: new PostgresSyncQueue(),
    recordAudit,
  };

  const result = await ingestWebhookRequest(
    provider,
    connectionId,
    (name) => request.headers.get(name),
    rawBody,
    deps,
  );

  if (result.outcome === 'ACCEPTED') {
    return Response.json({ ok: true }, { status: result.httpStatus });
  }
  // Opaque body — never reveal which check failed or whether the connection/org exists.
  return Response.json({ ok: false }, { status: result.httpStatus });
}
