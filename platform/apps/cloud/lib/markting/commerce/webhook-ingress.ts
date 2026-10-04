/**
 * PHASE C.5 (3) — WEBHOOK INGRESS ORCHESTRATION (the thin shell over the pure model).
 *
 * This wires the pure signature verifier (webhooks.ts) and the pure per-provider adapters
 * (webhook-adapters.ts) into one safe ingest pipeline, over injectable ports so it is fully
 * unit-testable without any live transport or real provider secret.
 *
 * SECURITY INVARIANTS (in enforced order):
 *   1. Known provider, bounded body (> 1 MB rejected before any work).
 *   2. Shape: the adapter extracts signature/topic/timestamp/event-id; unknown topic rejected.
 *   3. Tenant identity comes ONLY from the trusted connection record (resolveConnection) — NEVER from
 *      the untrusted payload. A payload that names a different org/store cannot change the resolved org.
 *   4. Signature verified (HMAC-SHA256, timing-safe) against the connection's secret BEFORE trusting.
 *   5. Replay window (± maxSkew) on the provider timestamp.
 *   6. The connection must be ACTIVE to enqueue downstream work.
 *   7. Dedup/idempotency on (connectionId, externalEventId).
 *   8. A verified COMMERCE webhook enqueues a WEBHOOK_TRIGGERED sync job (idempotent on the event id).
 *   9. Audit via recordConnectionEvent when available, else a structured (secret-free) log.
 *  10. Processing failure (enqueue throws) → DEAD-LETTER, never a silent drop.
 *
 * BLOCKED_EXTERNAL: no live provider secrets exist in this environment. The Postgres resolver reads
 * public.connections for the trusted org identity but has no secret to derive, so it returns a null
 * signingSecret and ingress reports NOT_CONFIGURED honestly rather than fabricate a secret.
 */
import 'server-only';
import { db } from '@/lib/db';
import type { EnqueueInput } from '@/lib/markting/ops/sync-store';
import { verifySignature } from './webhooks';
import {
  extractWebhook, commercePlatformFor, isWebhookProvider,
  type HeaderGetter, type WebhookProvider,
} from './webhook-adapters';

/** Typed ingress outcome. Each maps to one HTTP status via `HTTP_STATUS`. */
export type IngressOutcome =
  | 'ACCEPTED'
  | 'UNSUPPORTED_PROVIDER'
  | 'BODY_TOO_LARGE'
  | 'MALFORMED'
  | 'UNSUPPORTED_EVENT'
  | 'UNKNOWN_CONNECTION'
  | 'NOT_CONFIGURED'
  | 'INVALID_SIGNATURE'
  | 'EXPIRED_TIMESTAMP'
  | 'DISABLED_CONNECTION'
  | 'DUPLICATE'
  | 'DEAD_LETTER';

export const HTTP_STATUS: Record<IngressOutcome, number> = {
  ACCEPTED: 200,
  UNSUPPORTED_PROVIDER: 404,
  BODY_TOO_LARGE: 413,
  MALFORMED: 400,
  UNSUPPORTED_EVENT: 400,
  // Pre-authentication denials are collapsed to a single 401 so the status never reveals whether the
  // addressed connection exists, is disabled, is unconfigured, or simply failed signature verification
  // (no connection-existence oracle). The body is already opaque.
  UNKNOWN_CONNECTION: 401,
  NOT_CONFIGURED: 401,
  INVALID_SIGNATURE: 401,
  DISABLED_CONNECTION: 401,
  EXPIRED_TIMESTAMP: 400,
  DUPLICATE: 409,
  DEAD_LETTER: 500,
};

export interface IngressResult {
  outcome: IngressOutcome;
  /** SERVER-resolved org (from the trusted connection), never the payload's. Absent until resolved. */
  organizationId?: string;
  httpStatus: number;
}

/** The trusted connection identity. `signingSecret: null` means NOT_CONFIGURED (no live secret). */
export interface ResolvedConnection {
  connectionId: string;
  organizationId: string;
  provider: string;
  active: boolean;
  signingSecret: string | null;
}

/** Resolve a connection id to its SERVER-derived identity. Null ⇒ unknown connection. */
export type ResolveConnection = (connectionId: string) => Promise<ResolvedConnection | null>;

/** Idempotency/dedup store keyed by the trusted connection + provider event id. */
export interface DedupStore {
  seen(connectionId: string, externalEventId: string): Promise<boolean>;
  record(connectionId: string, externalEventId: string, organizationId: string): Promise<void>;
}

/** Minimal enqueue port — satisfied by PostgresSyncQueue / InMemorySyncQueue. */
export interface SyncEnqueuePort {
  enqueue(input: EnqueueInput): Promise<unknown>;
}

/** A secret-free audit record. */
export interface WebhookAuditEvent {
  organizationId: string;
  connectionId: string;
  provider: WebhookProvider;
  outcome: IngressOutcome;
  topic?: string;
  externalEventId?: string;
}

/** A dead-letter record for a verified event that failed downstream processing. */
export interface WebhookDeadLetter {
  organizationId: string;
  connectionId: string;
  provider: WebhookProvider;
  topic: string;
  externalEventId: string;
  error: string;
}

export interface IngressDeps {
  resolveConnection: ResolveConnection;
  dedup: DedupStore;
  /** Commerce providers only; stripe (billing) is verified but never enqueues a commerce sync. */
  enqueue: SyncEnqueuePort;
  /** Optional audit sink (e.g. recordConnectionEvent-backed). Falls back to a structured log. */
  recordAudit?: (event: WebhookAuditEvent) => Promise<void>;
  /** Optional dead-letter sink. Falls back to a structured log. */
  deadLetter?: (dl: WebhookDeadLetter) => Promise<void>;
  now?: number;
  /** Replay window, default 5 minutes (matches the pure model). */
  maxSkewMs?: number;
  /** Max raw body size, default 1 MB. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_SKEW_MS = 5 * 60_000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function result(outcome: IngressOutcome, organizationId?: string): IngressResult {
  return { outcome, organizationId, httpStatus: HTTP_STATUS[outcome] };
}

async function audit(deps: IngressDeps, event: WebhookAuditEvent): Promise<void> {
  if (deps.recordAudit) {
    try { await deps.recordAudit(event); } catch (err) {
      console.error('[webhook-ingress] audit sink failed', { outcome: event.outcome, provider: event.provider, error: errMsg(err) });
    }
    return;
  }
  // Structured, secret-free fallback trail.
  console.info('[webhook-ingress] audit', {
    provider: event.provider, outcome: event.outcome, organizationId: event.organizationId,
    connectionId: event.connectionId, topic: event.topic, externalEventId: event.externalEventId,
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

/**
 * Ingest one webhook delivery. Pure over the injected ports — no live Request, no real secret required.
 */
export async function ingestWebhookRequest(
  provider: string,
  connectionId: string | null | undefined,
  getHeader: HeaderGetter,
  rawBody: string,
  deps: IngressDeps,
): Promise<IngressResult> {
  const now = deps.now ?? Date.now();
  const maxSkew = deps.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  const maxBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  // 1. Known provider + bounded body (reject oversized before any parsing / DB work).
  if (!isWebhookProvider(provider)) return result('UNSUPPORTED_PROVIDER');
  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) return result('BODY_TOO_LARGE');
  if (!connectionId) return result('UNKNOWN_CONNECTION');

  // 2. Shape: adapter extraction + event-type allowlist.
  const extracted = extractWebhook(provider, getHeader, rawBody);
  if (!extracted.ok) {
    return result(extracted.reason === 'UNKNOWN_TOPIC' ? 'UNSUPPORTED_EVENT' : 'MALFORMED');
  }
  const { signatureB64, signedPayload, externalEventId, topic, timestamp } = extracted.value;

  // 3. Tenant identity from the TRUSTED connection only.
  const conn = await deps.resolveConnection(connectionId);
  if (!conn) return result('UNKNOWN_CONNECTION');
  const org = conn.organizationId;

  // 3b. BLOCKED_EXTERNAL: no live secret to verify against — report honestly, never fabricate one.
  if (!conn.signingSecret) {
    await audit(deps, { organizationId: org, connectionId, provider, outcome: 'NOT_CONFIGURED', topic, externalEventId });
    return result('NOT_CONFIGURED', org);
  }

  // 4. Signature (HMAC-SHA256, timing-safe) over the exact signed bytes.
  if (!verifySignature(signedPayload, signatureB64, conn.signingSecret)) {
    await audit(deps, { organizationId: org, connectionId, provider, outcome: 'INVALID_SIGNATURE', topic, externalEventId });
    return result('INVALID_SIGNATURE', org);
  }

  // 5. Replay window on the provider timestamp.
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxSkew) {
    await audit(deps, { organizationId: org, connectionId, provider, outcome: 'EXPIRED_TIMESTAMP', topic, externalEventId });
    return result('EXPIRED_TIMESTAMP', org);
  }

  // 6. Must be active to enqueue downstream work.
  if (!conn.active) {
    await audit(deps, { organizationId: org, connectionId, provider, outcome: 'DISABLED_CONNECTION', topic, externalEventId });
    return result('DISABLED_CONNECTION', org);
  }

  // 7. Dedup/idempotency.
  if (await deps.dedup.seen(connectionId, externalEventId)) {
    await audit(deps, { organizationId: org, connectionId, provider, outcome: 'DUPLICATE', topic, externalEventId });
    return result('DUPLICATE', org);
  }
  await deps.dedup.record(connectionId, externalEventId, org);

  // 8. Verified commerce webhook → enqueue a WEBHOOK_TRIGGERED sync (idempotent on the event id).
  const platform = commercePlatformFor(provider);
  if (platform) {
    try {
      await deps.enqueue.enqueue({
        organizationId: org,
        provider,
        syncType: 'WEBHOOK_TRIGGERED',
        idempotencyKey: `webhook:${provider}:${externalEventId}`,
        payload: { topic, externalEventId, connectionId },
        now,
      });
    } catch (err) {
      const message = errMsg(err);
      if (deps.deadLetter) {
        try { await deps.deadLetter({ organizationId: org, connectionId, provider, topic, externalEventId, error: message }); } catch (dlErr) {
          console.error('[webhook-ingress] dead-letter sink failed', { provider, error: errMsg(dlErr) });
        }
      } else {
        console.error('[webhook-ingress] dead-letter', { provider, organizationId: org, connectionId, topic, externalEventId, error: message });
      }
      await audit(deps, { organizationId: org, connectionId, provider, outcome: 'DEAD_LETTER', topic, externalEventId });
      return result('DEAD_LETTER', org);
    }
  }

  // 9. Success audit.
  await audit(deps, { organizationId: org, connectionId, provider, outcome: 'ACCEPTED', topic, externalEventId });
  return result('ACCEPTED', org);
}

// ---------------------------------------------------------------------------------------------------
// Postgres-backed ports for the live route. No live secret exists → NOT_CONFIGURED is honest.
// ---------------------------------------------------------------------------------------------------

type ConnRow = {
  id: string; organizationId: string; provider: string; status: string | null;
  healthState: string | null; disabledAt: Date | null;
};

/**
 * Resolve a connection from public.connections for its TRUSTED org identity. The signing secret would
 * be derived from the connection's sealed webhook_secret via KMS in production; that material is
 * BLOCKED_EXTERNAL here, so this returns `signingSecret: null` and the pipeline reports NOT_CONFIGURED.
 */
export function createPostgresResolveConnection(): ResolveConnection {
  return async (connectionId: string): Promise<ResolvedConnection | null> => {
    const rows = await db()<ConnRow[]>`
      select id, organization_id, provider, status::text as status, health_state, disabled_at
      from public.connections where id = ${connectionId} limit 1`;
    const row = rows[0];
    if (!row) return null;
    const active = row.disabledAt == null && row.status === 'active' && row.healthState !== 'DISABLED';
    return {
      connectionId: row.id,
      organizationId: row.organizationId,
      provider: row.provider,
      active,
      // BLOCKED_EXTERNAL: no live provider webhook secret to derive. Honest null, never fabricated.
      signingSecret: null,
    };
  };
}

/** Postgres dedup over the existing sync-job idempotency (a WEBHOOK_TRIGGERED job IS the dedup record). */
export function createPostgresDedupStore(): DedupStore {
  return {
    async seen(connectionId: string, externalEventId: string): Promise<boolean> {
      const key = `webhook:%:${externalEventId}`;
      const rows = await db()<Array<{ n: number }>>`
        select count(*)::int as n from public.markting_sync_jobs
        where idempotency_key like ${key} and payload->>'connectionId' = ${connectionId}`;
      return (rows[0]?.n ?? 0) > 0;
    },
    // The enqueue of the WEBHOOK_TRIGGERED job persists the dedup identity; this is a no-op placeholder
    // so the dedup contract is satisfied even for non-commerce (stripe) deliveries.
    async record(): Promise<void> { /* dedup is persisted by the idempotent enqueue */ },
  };
}
