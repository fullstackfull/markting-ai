'use server';
import { revalidatePath } from 'next/cache';
import { requirePlatformMutator } from '@/lib/platform/auth';
import { assertReason, recordPlatformAdminAudit } from '@/lib/platform/audit';
import { setKillSwitch } from '@/lib/markting/ops/store';

export interface ActionResult { ok: boolean; message: string }

/**
 * WAVE 4 — safe, fully-backed org lifecycle action: freeze / unfreeze provider WRITES for one
 * organization via the ORGANIZATION-scope kill switch. This is enforced server-side on the apply seam
 * (WAVE 0 / KillGuardedProvider), reason-required, role-gated (READ_ONLY_AUDITOR denied), and written
 * to the append-only platform admin audit. It does not bypass any tenant/business logic.
 */
export async function setOrgWriteFreeze(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const freeze = String(formData.get('freeze') ?? '') === 'true';
  try {
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return { ok: false, message: 'Invalid organization id.' };
    const reason = assertReason(String(formData.get('reason') ?? ''));
    const operator = await requirePlatformMutator();
    await setKillSwitch({ scope: 'ORGANIZATION', key: organizationId, organizationId, active: freeze, reason, setBy: operator.userId });
    await recordPlatformAdminAudit(operator, {
      action: freeze ? 'org.freeze_writes' : 'org.unfreeze_writes',
      targetType: 'organization', targetId: organizationId, reason,
      after: { killSwitch: { scope: 'ORGANIZATION', active: freeze } },
    });
    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: true, message: freeze ? 'Provider writes frozen for this organization.' : 'Provider writes unfrozen.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Action failed.' };
  }
}
