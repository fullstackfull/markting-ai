'use client';
import { useActionState } from 'react';
import { setOrgWriteFreeze, type ActionResult } from './actions';

/**
 * Reason-required confirm form for the org write-freeze control. The reason is mandatory and is
 * recorded in the platform admin audit. READ_ONLY_AUDITOR is rejected server-side.
 */
export function FreezeForm({ organizationId, frozen }: { organizationId: string; frozen: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setOrgWriteFreeze, null);
  return (
    <form className="admin-form" action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="freeze" value={frozen ? 'false' : 'true'} />
      <label className="admin-note" htmlFor="freeze-reason">Reason (required, audited)</label>
      <textarea id="freeze-reason" name="reason" required minLength={3} rows={2} placeholder="e.g. incident #1234 — suspected runaway spend" />
      <button className={`admin-btn${frozen ? '' : ' danger'}`} type="submit" disabled={pending}>
        {pending ? 'Working…' : frozen ? 'Unfreeze provider writes' : 'Freeze provider writes'}
      </button>
      {state && <p className="admin-note" style={{ color: state.ok ? '#7ee0a6' : '#ff9a8a' }}>{state.message}</p>}
    </form>
  );
}
