'use server';
import { revalidatePath } from 'next/cache';
import { requirePlatformRole } from '@/lib/platform/auth';
import { assertReason, recordPlatformAdminAudit } from '@/lib/platform/audit';
import { setKillSwitch } from '@/lib/markting/ops/store';

export interface ActionResult { ok: boolean; message: string }

/**
 * WAVE 13 — GLOBAL kill switch. The highest-impact safety control: halts ALL provider writes
 * platform-wide (enforced on the apply seam, WAVE 0). SUPER_ADMIN only, reason-required, audited.
 */
export async function setGlobalKill(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const active = String(formData.get('active') ?? '') === 'true';
  try {
    const reason = assertReason(String(formData.get('reason') ?? ''));
    const operator = await requirePlatformRole('SUPER_ADMIN');
    await setKillSwitch({ scope: 'GLOBAL', key: '', active, reason, setBy: operator.userId });
    await recordPlatformAdminAudit(operator, {
      action: active ? 'global.kill_on' : 'global.kill_off',
      targetType: 'platform', targetId: 'GLOBAL', reason, after: { globalKill: active },
    });
    revalidatePath('/admin/governance');
    revalidatePath('/admin/security');
    return { ok: true, message: active ? 'GLOBAL kill switch ACTIVE — all provider writes halted platform-wide.' : 'GLOBAL kill switch cleared.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Action failed.' };
  }
}
