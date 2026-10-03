/**
 * Phase 5I — commerce WEBHOOK ingestion. Webhook payloads are UNTRUSTED input:
 *  - Verify the provider signature (HMAC) before anything else; reject on mismatch.
 *  - NEVER trust the organization/store id in the payload — resolve the tenant through the authenticated
 *    connection mapping (a webhook is addressed to a connectionId whose org is server-derived).
 *  - Deduplicate by a persisted event identity, and add replay protection (reject stale timestamps).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CommercePlatform } from './model';

export interface WebhookEnvelope {
  connectionId: string;          // the authenticated connection the hook is addressed to
  platform: CommercePlatform;
  externalEventId: string;       // provider event id (for dedup)
  topic: string;
  signature: string;             // provider-supplied signature header
  timestamp: string;             // provider-supplied event time (ISO)
  rawBody: string;               // exact bytes used for signature verification
}

export interface WebhookResult {
  accepted: boolean;
  reason?: 'INVALID_SIGNATURE' | 'DUPLICATE' | 'REPLAY' | 'UNKNOWN_CONNECTION' | 'OK';
  /** The SERVER-resolved org (from the connection), never the payload's org. */
  organizationId?: string;
}

export interface WebhookPorts {
  /** Resolve a connection to its server-derived org + signing secret. Null if unknown. */
  resolveConnection(connectionId: string): Promise<{ organizationId: string; signingSecret: string } | null>;
  /** True if this external event id was already processed (dedup). */
  seen(connectionId: string, externalEventId: string): Promise<boolean>;
  /** Persist the event identity so replays/dupes are rejected. */
  record(connectionId: string, externalEventId: string, organizationId: string): Promise<void>;
}

/** HMAC-SHA256 verification over the raw body with the connection's signing secret. */
export function verifySignature(rawBody: string, signatureB64: string, signingSecret: string): boolean {
  const expected = createHmac('sha256', signingSecret).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try { provided = Buffer.from(signatureB64, 'base64'); } catch { return false; }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Ingest a webhook safely. Order of checks: resolve connection (→ org + secret) → verify signature →
 * replay-window → dedup → record. The payload's own org/store id is NEVER used to decide the tenant.
 */
export async function ingestWebhook(env: WebhookEnvelope, ports: WebhookPorts, opts: { now?: number; maxSkewMs?: number } = {}): Promise<WebhookResult> {
  const now = opts.now ?? Date.now();
  const maxSkew = opts.maxSkewMs ?? 5 * 60_000; // 5 min replay window

  const conn = await ports.resolveConnection(env.connectionId);
  if (!conn) return { accepted: false, reason: 'UNKNOWN_CONNECTION' };

  if (!verifySignature(env.rawBody, env.signature, conn.signingSecret)) return { accepted: false, reason: 'INVALID_SIGNATURE', organizationId: conn.organizationId };

  const ts = Date.parse(env.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxSkew) return { accepted: false, reason: 'REPLAY', organizationId: conn.organizationId };

  if (await ports.seen(env.connectionId, env.externalEventId)) return { accepted: false, reason: 'DUPLICATE', organizationId: conn.organizationId };

  await ports.record(env.connectionId, env.externalEventId, conn.organizationId);
  return { accepted: true, reason: 'OK', organizationId: conn.organizationId };
}
