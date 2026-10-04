'use client';
import { useActionState } from 'react';

export interface ActionResult { ok: boolean; message: string }
type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * Reusable reason-required platform-admin action form. Every sensitive mutation includes a mandatory
 * reason (recorded in the append-only platform admin audit) and surfaces the server result inline.
 * Server actions are role-gated server-side; READ_ONLY_AUDITOR is rejected there regardless of UI.
 */
export function AdminActionForm({ action, submitLabel, danger, hidden, children }: {
  action: Action; submitLabel: string; danger?: boolean; hidden?: Record<string, string>; children?: React.ReactNode;
}) {
  const [state, run, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form className="admin-form" action={run}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <label className="admin-note">Reason (required, audited)
        <textarea name="reason" required minLength={3} rows={2} style={{ display: 'block', width: '100%', marginTop: '0.3rem' }} />
      </label>
      <button className={`admin-btn${danger ? ' danger' : ''}`} type="submit" disabled={pending}>{pending ? 'Working…' : submitLabel}</button>
      {state && <p className="admin-note" style={{ color: state.ok ? '#7ee0a6' : '#ff9a8a' }}>{state.message}</p>}
    </form>
  );
}
