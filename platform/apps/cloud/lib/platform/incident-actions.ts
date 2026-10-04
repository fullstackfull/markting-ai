'use server';
import { revalidatePath } from 'next/cache';
import { requirePlatformMutator } from './auth';
import { assertReason, recordPlatformAdminAudit } from './audit';
import { PostgresIncidentStore } from '@/lib/markting/ops/incident-store';
import { openIncident, transitionIncident, assignOwner, addNote, type IncidentState, type IncidentSeverity } from '@/lib/markting/ops/incidents';

/**
 * PHASE C.5 (5) — operator incident mutations. Every action is role-gated (platform mutator,
 * never READ_ONLY_AUDITOR), reason-required (assertReason), and audited (recordPlatformAdminAudit).
 */

export interface ActionResult { ok: boolean; message: string }
const fail = (message: string): ActionResult => ({ ok: false, message });
const UUID = /^[0-9a-f-]{36}$/i;
const store = () => new PostgresIncidentStore();

export async function createIncidentAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const title = String(form.get('title') ?? '').trim();
    const severity = String(form.get('severity') ?? 'WARNING') as IncidentSeverity;
    if (title.length < 3) return fail('A title is required.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformMutator('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const created = await store().create(openIncident({ title, severity, source: 'operator', now: Date.now() }));
    await recordPlatformAdminAudit(op, { action: 'incident.open', targetType: 'incident', targetId: created.id!, reason, after: { title, severity } });
    revalidatePath('/admin/incidents');
    return { ok: true, message: `Incident opened (${created.id}).` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

export async function transitionIncidentAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('incidentId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid incident id.');
    const to = String(form.get('to') ?? '') as IncidentState;
    const resolution = String(form.get('resolution') ?? '').trim() || undefined;
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformMutator('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const incident = await store().get(id);
    if (!incident) return fail('Incident not found.');
    const next = transitionIncident(incident, { to, actor: op.userId, reason, now: Date.now(), resolution });
    await store().save(next);
    await recordPlatformAdminAudit(op, { action: `incident.${to.toLowerCase()}`, targetType: 'incident', targetId: id, reason, before: { state: incident.state }, after: { state: to } });
    revalidatePath('/admin/incidents');
    return { ok: true, message: `Incident → ${to}.` };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

export async function assignIncidentAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('incidentId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid incident id.');
    const ownerId = String(form.get('ownerOperatorId') ?? '').trim();
    if (!UUID.test(ownerId)) return fail('Invalid owner id.');
    const reason = assertReason(String(form.get('reason') ?? ''));
    const op = await requirePlatformMutator('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const incident = await store().get(id);
    if (!incident) return fail('Incident not found.');
    await store().save(assignOwner(incident, ownerId, Date.now(), op.userId));
    await recordPlatformAdminAudit(op, { action: 'incident.assign', targetType: 'incident', targetId: id, reason, after: { ownerOperatorId: ownerId } });
    revalidatePath('/admin/incidents');
    return { ok: true, message: 'Incident assigned.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}

export async function addIncidentNoteAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get('incidentId') ?? '');
  try {
    if (!UUID.test(id)) return fail('Invalid incident id.');
    const note = String(form.get('note') ?? '').trim();
    if (note.length < 1) return fail('A note is required.');
    const reason = assertReason(String(form.get('reason') ?? note));
    const op = await requirePlatformMutator('SUPER_ADMIN', 'PLATFORM_OPERATOR');
    const incident = await store().get(id);
    if (!incident) return fail('Incident not found.');
    await store().save(addNote(incident, note, op.userId, Date.now()));
    await recordPlatformAdminAudit(op, { action: 'incident.note', targetType: 'incident', targetId: id, reason, after: { note } });
    revalidatePath('/admin/incidents');
    return { ok: true, message: 'Note added.' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Failed.'); }
}
