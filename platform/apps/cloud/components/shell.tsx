import Link from 'next/link';
import { signOut } from '@/app/dashboard/actions';
import { BrandLockup } from '@/components/logos';
import { Nav, UtilityNav } from '@/components/nav';
import { SupportWidget } from '@/components/support-widget';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ClientSwitcher } from '@/components/client-switcher';
import { getT } from '@/lib/i18n/server';

export interface ShellTenant {
  organizationName: string;
  userName: string;
  email: string;
  role: string;
}

export async function Shell({ tenant, children }: { tenant: ShellTenant; children: React.ReactNode }) {
  const { t } = await getT();
  const roleKey = `common.role_${tenant.role}`;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link className="brand-lockup" href="/dashboard" prefetch={false} aria-label={t('nav.overviewLink')}>
            <BrandLockup />
          </Link>
          <div className="workspace">
            <span className="workspace-name">{tenant.organizationName}</span>
            <ClientSwitcher />
          </div>
        </div>
        <Nav />
        <div className="sidebar-lower"><UtilityNav /></div>
        <div className="sidebar-foot">
          <div className="user">
            <span className="avatar" aria-hidden="true">{tenant.userName.slice(0, 1).toUpperCase()}</span>
            <span className="user-text">
              <span className="user-name">{tenant.userName}</span>
              <span className="user-sub">{t(roleKey)} · {tenant.email}</span>
            </span>
          </div>
          <div className="sidebar-foot-actions">
            <form action={signOut}>
              <button className="link-button" type="submit">{t('common.signOut')}</button>
            </form>
            <LocaleSwitcher compact />
          </div>
        </div>
      </aside>
      <div className="main">{children}</div>
      <SupportWidget />
    </div>
  );
}
