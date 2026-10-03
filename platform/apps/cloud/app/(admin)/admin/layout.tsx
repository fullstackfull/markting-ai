import { notFound } from 'next/navigation';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { isDemoMode } from '@/lib/markting/env';
import { AdminNav } from '@/components/admin/admin-nav';

export const dynamic = 'force-dynamic';

/**
 * WAVE 2 — Platform Admin shell. Guards EVERY /admin route server-side (never nav hiding): a
 * non-operator gets notFound() so the plane's existence is not disclosed. The chrome is deliberately
 * distinct from the tenant workspace (dark plane, PLATFORM ADMIN banner, operator + role + environment)
 * so an operator always knows they are NOT inside a customer's workspace.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let operator;
  try {
    operator = await requirePlatformOperator();
  } catch {
    notFound();
  }
  const demo = isDemoMode();
  return (
    <div className="admin-root">
      <aside className="admin-side">
        <div className="admin-brand">
          <b>Platform Admin</b>
          <span>MARKTING-AI control plane</span>
          <span className={`admin-pill ${demo ? 'demo' : 'prod'}`}>{demo ? 'DEMO / TEST' : 'PRODUCTION'}</span>
        </div>
        <AdminNav />
      </aside>
      <main className="admin-main">
        <div className="admin-topbar">
          <h1>Platform Admin</h1>
          <div className="admin-who">
            <div><b>{operator.email || operator.userId}</b></div>
            <div>{operator.role}</div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
