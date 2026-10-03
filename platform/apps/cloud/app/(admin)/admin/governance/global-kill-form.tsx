'use client';
import { useActionState } from 'react';
import { setGlobalKill, type ActionResult } from './actions';

export function GlobalKillForm({ active }: { active: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setGlobalKill, null);
  return (
    <form className="admin-form" action={action}>
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <label className="admin-note" htmlFor="gk-reason">Reason (required, audited) — SUPER_ADMIN only</label>
      <textarea id="gk-reason" name="reason" required minLength={3} rows={2} placeholder="e.g. platform-wide incident — halting all provider writes" />
      <button className={`admin-btn${active ? '' : ' danger'}`} type="submit" disabled={pending}>
        {pending ? 'Working…' : active ? 'Clear GLOBAL kill switch' : 'Activate GLOBAL kill switch'}
      </button>
      {state && <p className="admin-note" style={{ color: state.ok ? '#7ee0a6' : '#ff9a8a' }}>{state.message}</p>}
    </form>
  );
}
