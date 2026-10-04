import 'server-only';
import { db } from '@/lib/db';
import type { ConnectionEvent, ConnectionErrorClass } from './vocabulary';

/**
 * CONNECTIONS CONTROL PLANE — append-only connection audit recorder.
 *
 * Every important connection lifecycle event is recorded here. NO secret material is ever written: detail
 * carries only non-secret facts (counts, provider ids, status transitions). This is distinct from the
 * tenant audit_events feed and the platform_admin_audit feed; it is the connection-specific trail that
 * both the tenant Connection Center and the Super Admin Integration Center read.
 */
export interface ConnectionEventInput {
  organizationId: string;
  connectionId?: string | null;
  provider: string;
  connectionType?: string;
  event: ConnectionEvent;
  actorType?: 'tenant_user' | 'platform_operator' | 'system';
  actorId?: string | null;
  platformRole?: string | null;
  reason?: string | null;
  errorClass?: ConnectionErrorClass | null;
  detail?: Record<string, unknown> | null;
}

export async function recordConnectionEvent(input: ConnectionEventInput): Promise<void> {
  await db()`
    insert into public.connection_events
      (organization_id, connection_id, provider, connection_type, event, actor_type, actor_id, platform_role, reason, error_classification, detail)
    values (${input.organizationId}, ${input.connectionId ?? null}, ${input.provider}, ${input.connectionType ?? 'ad_platform'},
      ${input.event}, ${input.actorType ?? 'system'}, ${input.actorId ?? null}, ${input.platformRole ?? null},
      ${input.reason ?? null}, ${input.errorClass ?? null},
      ${input.detail === undefined || input.detail === null ? null : db().json(input.detail as never)})
  `;
}

export async function listConnectionEvents(organizationId: string, opts: { connectionId?: string; provider?: string; limit?: number } = {}) {
  const sql = db();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const connFilter = opts.connectionId ? sql`and connection_id = ${opts.connectionId}` : sql``;
  const provFilter = opts.provider ? sql`and provider = ${opts.provider}` : sql``;
  return sql<Array<{ id: string; connectionId: string | null; provider: string; event: string; actorType: string; reason: string | null; errorClassification: string | null; createdAt: Date }>>`
    select id, connection_id as "connectionId", provider, event, actor_type as "actorType", reason,
      error_classification as "errorClassification", created_at as "createdAt"
    from public.connection_events
    where organization_id = ${organizationId} ${connFilter} ${provFilter}
    order by created_at desc limit ${limit}`;
}
