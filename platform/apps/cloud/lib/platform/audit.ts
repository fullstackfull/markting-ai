import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { PlatformOperator } from './auth';

/**
 * WAVE 1 — append-only platform admin audit. Every privileged platform mutation writes exactly one
 * row here (separate from tenant audit_events, linkable by correlation_id). The table grants backend
 * only SELECT/INSERT — never UPDATE/DELETE — so the trail is immutable through the app.
 */
export interface PlatformAuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  correlationId?: string;
  before?: unknown;
  after?: unknown;
}

/** Sensitive mutations MUST pass a human-readable reason; this throws if one is missing. */
export function assertReason(reason: string | undefined | null): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 3) throw new Error('A human-readable reason is required for this action.');
  return trimmed.slice(0, 2000);
}

export async function recordPlatformAdminAudit(operator: PlatformOperator, entry: PlatformAuditEntry): Promise<string> {
  const correlationId = entry.correlationId ?? randomUUID();
  await db()`
    insert into public.platform_admin_audit
      (actor_user_id, platform_role, action, target_type, target_id, reason, correlation_id, before_summary, after_summary)
    values (${operator.userId}, ${operator.role}, ${entry.action}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
      ${entry.reason ?? null}, ${correlationId},
      ${entry.before === undefined ? null : db().json(entry.before as never)},
      ${entry.after === undefined ? null : db().json(entry.after as never)})
  `;
  return correlationId;
}
