'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePlatformMutator, requirePlatformRole } from '@/lib/platform/auth';
import { assertReason, recordPlatformAdminAudit } from '@/lib/platform/audit';
import { recordConnectionEvent } from './events';
import { detectConnectionIncidents } from './platform-read';
import { deriveConnectionHealth } from './status';
import type { ConnectionErrorClass } from './vocabulary';

/**
 * CONNECTIONS CONTROL PLANE — Super Admin integration ACTIONS.
 *
 * Every action is role-gated server-side (READ_ONLY_AUDITOR rejected), reason-required, written to the
 * append-only platform_admin_audit AND the connection_events trail. Credential-changing actions are
 * deliberately NOT offered: there is no plaintext token-replacement UI. The strongest action is to
 * DISABLE a connection (fails closed — disabled connections are never loaded into the tenant runtime)
 * or to REQUEST that the tenant reauthorize. Mutations go through the ordinary backend db() AFTER the
 * guard, never through the SELECT-only platform read role.
 */
export interface ActionResult { ok: boolean; message: string }
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (message: string): ActionResult => ({ ok: false, message });

interface ConnRow { id: string; organizationId: string; provider: string; connectionType: string; status: string; healthState: string | null; errorClassification: string | null; tokenExpiresAt: Date | null; disabledAt: Date | null }

async function loadConnection(id: string): Promise<ConnRow | undefined> {
  const rows = await db()<ConnRow[]>`
    select id, organization_id as "organizationId", provider, connection_type as "connectionType", status::text as status,
      health_state as "healthState", error_classification as "errorClassification", token_expires_at as "tokenExpiresAt", disabled_at as "disabledAt"
    from public.connections where id = ${id} limit 1`;
  return rows[0];
}

/**
 * Force a deterministic health RECHECK: recompute health_state from the connection's stored signals (NOT
 * a live provider probe — a live probe requires tenant credentials, which operators never hold). Honest:
 * this re-derives from what is already known (status, expiry, error class), never fabricates reachability.
 */
export async function forceHealthRecheck(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('connectionId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid connection id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformMutator();
    const conn = await loadConnection(id);
    if (!conn) return fail('Connection not found.');
    const errorClass = conn.errorClassification as ConnectionErrorClass | null;
    const { state } = deriveConnectionHealth({
      baseStatus: conn.status as 'connected' | 'error' | 'revoked',
      disabled: !!conn.disabledAt,
      tokenExpiresAt: conn.tokenExpiresAt ? conn.tokenExpiresAt.toISOString() : null,
      errorClass,
      lastProbeOk: conn.status === 'connected' ? true : conn.status === 'error' ? false : undefined,
      recentAuthFailures: errorClass === 'AUTH_ERROR' || errorClass === 'TOKEN_EXPIRED' ? 3 : 0,
      recentRateLimited: errorClass === 'RATE_LIMIT',
    });
    await db()`update public.connections set health_state = ${state} where id = ${id}`;
    await recordConnectionEvent({ organizationId: conn.organizationId, connectionId: id, provider: conn.provider, connectionType: conn.connectionType, event: 'health_recheck', actorType: 'platform_operator', actorId: op.userId, platformRole: op.role, reason, detail: { health: state, basis: 'recomputed_from_stored_signals' } });
    await recordPlatformAdminAudit(op, { action: 'connection.health_recheck', targetType: 'connection', targetId: id, reason, after: { health: state } });
    revalidatePath('/admin/integrations');
    return { ok: true, message: `Health recomputed: ${state} (from stored signals; live provider probe requires tenant credentials).` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** Request that the tenant reauthorize a connection. Sets reauth_required; surfaced in the tenant Connection Center. */
export async function requestReauthorization(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('connectionId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid connection id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformMutator();
    const conn = await loadConnection(id);
    if (!conn) return fail('Connection not found.');
    await db()`update public.connections set reauth_required = true where id = ${id}`;
    await recordConnectionEvent({ organizationId: conn.organizationId, connectionId: id, provider: conn.provider, connectionType: conn.connectionType, event: 'reauth_requested', actorType: 'platform_operator', actorId: op.userId, platformRole: op.role, reason });
    await recordPlatformAdminAudit(op, { action: 'connection.request_reauth', targetType: 'connection', targetId: id, reason });
    revalidatePath('/admin/integrations');
    return { ok: true, message: 'Reauthorization requested — the tenant will see a reauthorize prompt in their Connection Center.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** Disable a broken connection (fails closed: disabled connections are never loaded into the tenant runtime). */
export async function disableConnection(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('connectionId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid connection id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const conn = await loadConnection(id);
    if (!conn) return fail('Connection not found.');
    await db()`update public.connections set disabled_at = now(), disabled_by = ${op.userId}, disabled_reason = ${reason}, health_state = 'DISABLED' where id = ${id}`;
    await recordConnectionEvent({ organizationId: conn.organizationId, connectionId: id, provider: conn.provider, connectionType: conn.connectionType, event: 'disabled', actorType: 'platform_operator', actorId: op.userId, platformRole: op.role, reason });
    await recordPlatformAdminAudit(op, { action: 'connection.disable', targetType: 'connection', targetId: id, reason, after: { disabled: true } });
    revalidatePath('/admin/integrations');
    return { ok: true, message: 'Connection disabled (fails closed — no reads/writes will load this grant).' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** Re-enable a previously disabled connection. */
export async function enableConnection(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('connectionId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid connection id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const conn = await loadConnection(id);
    if (!conn) return fail('Connection not found.');
    await db()`update public.connections set disabled_at = null, disabled_by = null, disabled_reason = null where id = ${id}`;
    await recordConnectionEvent({ organizationId: conn.organizationId, connectionId: id, provider: conn.provider, connectionType: conn.connectionType, event: 'enabled', actorType: 'platform_operator', actorId: op.userId, platformRole: op.role, reason });
    await recordPlatformAdminAudit(op, { action: 'connection.enable', targetType: 'connection', targetId: id, reason, after: { disabled: false } });
    revalidatePath('/admin/integrations');
    return { ok: true, message: 'Connection re-enabled.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** Retry a connection's data sync. Honest: no in-repo background sync runner exists → BLOCKED_EXTERNAL. */
export async function retryConnectionSync(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('connectionId') ?? '');
  try {
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformMutator();
    const conn = id && UUID.test(id) ? await loadConnection(id) : undefined;
    await recordPlatformAdminAudit(op, { action: 'connection.retry_sync', targetType: 'connection', targetId: id || undefined, reason, after: { requested: true } });
    if (conn) await recordConnectionEvent({ organizationId: conn.organizationId, connectionId: id, provider: conn.provider, connectionType: conn.connectionType, event: 'sync_triggered', actorType: 'platform_operator', actorId: op.userId, platformRole: op.role, reason });
    return { ok: true, message: 'Sync retry recorded. NOTE: no in-repo background sync runner exists (BLOCKED_EXTERNAL) — this records intent and will take effect once a runner is deployed.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** Run deterministic incident detection and publish each incident to the platform notifications inbox. */
export async function scanConnectionIncidents(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const reason = assertReason(String(form.get('reason') ?? 'Operator-triggered integration incident scan.'));
    const op = await requirePlatformMutator();
    const incidents = await detectConnectionIncidents();
    for (const inc of incidents) {
      await db()`
        insert into public.platform_admin_notifications (kind, severity, title, detail, dedupe_key)
        values (${`connection:${inc.kind}`}, ${inc.severity}, ${inc.title}, ${inc.detail}, ${`connection:${inc.dedupeKey}`})
        on conflict (dedupe_key) where acknowledged = false do nothing`;
    }
    await recordPlatformAdminAudit(op, { action: 'connection.incident_scan', targetType: 'fleet', reason, after: { incidents: incidents.length } });
    revalidatePath('/admin/integrations');
    revalidatePath('/admin/notifications');
    return { ok: true, message: `Scan complete — ${incidents.length} incident(s) published to the notifications inbox.` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}
