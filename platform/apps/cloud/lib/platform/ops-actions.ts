'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePlatformMutator, requirePlatformRole } from './auth';
import { assertReason, recordPlatformAdminAudit } from './audit';

export interface ActionResult { ok: boolean; message: string }
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (message: string): ActionResult => ({ ok: false, message });
const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** WAVE 7 — per-org entitlement override (GAP-PLN-02). SUPER_ADMIN / PLATFORM_OPERATOR. */
export async function setEntitlementOverride(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const organizationId = String(form.get('organizationId') ?? '');
  try {
    if (!UUID.test(organizationId)) return fail('Invalid organization id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const cols = {
      maxActiveAccounts: toIntOrNull(form.get('maxActiveAccounts')),
      maxMembers: toIntOrNull(form.get('maxMembers')),
      maxRetentionDays: toIntOrNull(form.get('maxRetentionDays')),
    };
    await db()`
      insert into public.organization_entitlement_overrides
        (organization_id, max_active_accounts, max_members, max_retention_days, reason, set_by)
      values (${organizationId}, ${cols.maxActiveAccounts}, ${cols.maxMembers}, ${cols.maxRetentionDays}, ${reason}, ${op.userId})
      on conflict (organization_id) do update set
        max_active_accounts = excluded.max_active_accounts, max_members = excluded.max_members,
        max_retention_days = excluded.max_retention_days, reason = excluded.reason, set_by = excluded.set_by, updated_at = now()`;
    await recordPlatformAdminAudit(op, { action: 'org.entitlement_override', targetType: 'organization', targetId: organizationId, reason, after: cols });
    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: true, message: 'Entitlement override saved (safety ceiling applied).' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 9 — per-org AI control: hard disable + quota override. SUPER_ADMIN / PLATFORM_OPERATOR. */
export async function setOrgAiControl(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const organizationId = String(form.get('organizationId') ?? '');
  try {
    if (!UUID.test(organizationId)) return fail('Invalid organization id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const aiDisabled = String(form.get('aiDisabled') ?? '') === 'true';
    const maxRequests = toIntOrNull(form.get('maxRequests'));
    const maxCostMicros = toIntOrNull(form.get('maxCostMicros'));
    await db()`
      insert into public.organization_ai_limits (organization_id, ai_disabled, max_requests_per_window, max_cost_micros_per_window, reason, set_by)
      values (${organizationId}, ${aiDisabled}, ${maxRequests}, ${maxCostMicros}, ${reason}, ${op.userId})
      on conflict (organization_id) do update set ai_disabled = excluded.ai_disabled,
        max_requests_per_window = excluded.max_requests_per_window, max_cost_micros_per_window = excluded.max_cost_micros_per_window,
        reason = excluded.reason, set_by = excluded.set_by, updated_at = now()`;
    await recordPlatformAdminAudit(op, { action: aiDisabled ? 'org.ai_disable' : 'org.ai_update', targetType: 'organization', targetId: organizationId, reason, after: { aiDisabled, maxRequests, maxCostMicros } });
    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: true, message: aiDisabled ? 'AI disabled for this organization.' : 'AI limits updated.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 7 — edit a plan's limits in the catalog (SUPER_ADMIN). Never touches historical invoices. */
export async function updatePlan(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('id') ?? '');
  try {
    if (!['reader', 'operator', 'premium', 'agency', 'enterprise'].includes(id)) return fail('Invalid plan id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN');
    const vals = { maxActiveAccounts: toIntOrNull(form.get('maxActiveAccounts')), maxMembers: toIntOrNull(form.get('maxMembers')), maxRetentionDays: toIntOrNull(form.get('maxRetentionDays')) };
    if (vals.maxRetentionDays === null) return fail('maxRetentionDays is required.');
    await db()`
      update public.platform_plans set max_active_accounts = ${vals.maxActiveAccounts}, max_members = ${vals.maxMembers},
        max_retention_days = ${vals.maxRetentionDays}, updated_at = now() where id = ${id}`;
    await recordPlatformAdminAudit(op, { action: 'plan.update', targetType: 'plan', targetId: id, reason, after: vals });
    revalidatePath('/admin/billing');
    return { ok: true, message: `Plan ${id} limits updated.` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 16 — upsert a feature flag (SUPER_ADMIN / PLATFORM_OPERATOR). Flags are never authorization. */
export async function upsertFeatureFlag(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const key = String(form.get('key') ?? '').trim();
    const scope = String(form.get('scope') ?? 'global');
    const scopeKey = String(form.get('scopeKey') ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_.-]{1,62}$/.test(key)) return fail('Invalid flag key.');
    if (!['global', 'plan', 'org'].includes(scope)) return fail('Invalid scope.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const enabled = String(form.get('enabled') ?? '') === 'true';
    const rollout = Math.min(Math.max(toIntOrNull(form.get('rolloutPercent')) ?? 100, 0), 100);
    await db()`
      insert into public.platform_feature_flags (key, scope, scope_key, enabled, rollout_percent, reason, created_by)
      values (${key}, ${scope}, ${scopeKey}, ${enabled}, ${rollout}, ${reason}, ${op.userId})
      on conflict (key, scope, scope_key) do update set enabled = excluded.enabled, rollout_percent = excluded.rollout_percent,
        reason = excluded.reason, updated_at = now()`;
    await recordPlatformAdminAudit(op, { action: 'flag.upsert', targetType: 'feature_flag', targetId: `${key}:${scope}:${scopeKey}`, reason, after: { enabled, rollout } });
    revalidatePath('/admin/flags');
    return { ok: true, message: `Flag ${key} (${scope}) saved.` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 17 — set a non-secret platform setting (SUPER_ADMIN). */
export async function updatePlatformSetting(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const key = String(form.get('key') ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_.-]{1,62}$/.test(key)) return fail('Invalid setting key.');
    const raw = String(form.get('value') ?? '').trim();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return fail('Value must be valid JSON.'); }
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN');
    await db()`
      insert into public.platform_settings (key, value, updated_by) values (${key}, ${db().json(value as never)}, ${op.userId})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
    await recordPlatformAdminAudit(op, { action: 'setting.update', targetType: 'setting', targetId: key, reason, after: { value } });
    revalidatePath('/admin/settings');
    return { ok: true, message: `Setting ${key} saved.` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 15 — advance a support ticket's status (SUPPORT_ADMIN / PLATFORM_OPERATOR / SUPER_ADMIN). */
export async function updateSupportStatus(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('id') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid ticket id.');
    const status = String(form.get('status') ?? '');
    if (!['new', 'in_progress', 'resolved'].includes(status)) return fail('Invalid status.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR', 'SUPPORT_ADMIN');
    await db()`update public.feedback set status = ${status} where id = ${id}`;
    await recordPlatformAdminAudit(op, { action: 'support.status', targetType: 'feedback', targetId: id, reason, after: { status } });
    revalidatePath('/admin/support');
    return { ok: true, message: `Ticket marked ${status}.` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 19 — acknowledge a platform notification (any mutator). */
export async function acknowledgeNotification(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('id') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid id.');
    const op = await requirePlatformMutator();
    await db()`update public.platform_admin_notifications set acknowledged = true where id = ${id}`;
    await recordPlatformAdminAudit(op, { action: 'notification.ack', targetType: 'notification', targetId: id });
    revalidatePath('/admin/notifications');
    return { ok: true, message: 'Acknowledged.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

/** WAVE 8 — mark a billing failure resolved (PLATFORM_OPERATOR / SUPER_ADMIN). */
export async function resolveBillingFailure(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('id') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformRole('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    await db()`update public.billing_failures set resolved = true where id = ${id}`;
    await recordPlatformAdminAudit(op, { action: 'billing.failure_resolved', targetType: 'billing_failure', targetId: id, reason });
    revalidatePath('/admin/billing');
    return { ok: true, message: 'Marked resolved.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}
