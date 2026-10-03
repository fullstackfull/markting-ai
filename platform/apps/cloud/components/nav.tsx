'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SUPPORT_OPEN_EVENT } from './support-widget';
import { useI18n } from './i18n-provider';

type NavItem = { label: string; href: string; icon: React.ReactNode; exact?: boolean };

const icon = {
  overview: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></svg>,
  connections: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5" /><path d="M12.5 6.8 14 5.3a3.9 3.9 0 0 1 5.5 5.5l-2.4 2.4" /><path d="M11.5 17.2 10 18.7a3.9 3.9 0 0 1-5.5-5.5l2.4-2.4" /></svg>,
  accounts: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h16v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-10Z" /><path d="M8 8.5v-2A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5v2" /><path d="M4 13h16" /></svg>,
  reports: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10" /><path d="M12 20V4" /><path d="M19 20v-7" /></svg>,
  findings: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" /><path d="M8.5 11.8 11 14l4.5-4.5" /></svg>,
  approvals: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" /></svg>,
  audit: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v13.5l-3-1.8-3.5 1.8-3.5-1.8-3 1.8V6A1.5 1.5 0 0 1 7 4.5Z" /><path d="M9 9h6" /><path d="M9 12.5h6" /></svg>,
  policies: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6v5.5c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6l7-2.5Z" /><path d="m9.3 11.8 2 2 3.4-3.6" /></svg>,
  team: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.4-3.1 2.7-5 5.5-5s5.1 1.9 5.5 5" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M15.2 14.6c2.6.1 4.6 1.8 5.1 4.6" /></svg>,
  agents: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 9.5 5 12l3.5 2.5" /><path d="m15.5 9.5 3.5 2.5-3.5 2.5" /><path d="m13.2 6.5-2.4 11" /></svg>,
  billing: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M3.5 9.5h17" /><path d="M7.5 14.5h3" /></svg>,
  assistant: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4.5 3.5v-3.5h-1a2 2 0 0 1-2-2v-7Z" /><path d="M8.5 9h7" /><path d="M8.5 12h4" /></svg>,
  support: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M8.2 8.2 6 6" /><path d="m15.8 8.2 2.2-2.2" /><path d="m8.2 15.8-2.2 2.2" /><path d="m15.8 15.8 2.2 2.2" /><circle cx="12" cy="12" r="3.4" /></svg>,
};

const PRIMARY_ITEMS: NavItem[] = [
  { label: 'nav.overview', href: '/dashboard', icon: icon.overview, exact: true },
  { label: 'nav.workspace', href: '/dashboard/workspace', icon: icon.findings },
  { label: 'nav.assistant', href: '/dashboard/assistant', icon: icon.assistant },
  { label: 'nav.recommendations', href: '/dashboard/recommendations', icon: icon.approvals },
  { label: 'nav.connections', href: '/dashboard/connections', icon: icon.connections },
  { label: 'nav.accounts', href: '/dashboard/accounts', icon: icon.accounts },
  { label: 'nav.reports', href: '/dashboard/reports', icon: icon.reports },
  { label: 'nav.findings', href: '/dashboard/findings', icon: icon.findings },
  { label: 'nav.approvals', href: '/dashboard/approvals', icon: icon.approvals },
  { label: 'nav.audit', href: '/dashboard/audit', icon: icon.audit },
];

const UTILITY_ITEMS: NavItem[] = [
  { label: 'nav.agents', href: '/dashboard/agents', icon: icon.agents },
  { label: 'nav.policies', href: '/dashboard/policies', icon: icon.policies },
  { label: 'nav.team', href: '/dashboard/team', icon: icon.team },
  { label: 'nav.plan', href: '/dashboard/billing', icon: icon.billing },
];

function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return items.map((item) => {
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    return <Link key={item.href} href={item.href} prefetch={false} aria-current={active ? 'page' : undefined}>{item.icon}{t(item.label)}</Link>;
  });
}

export function Nav() {
  const { t } = useI18n();
  return <nav className="nav" aria-label={t('nav.cloudNavigation')}><NavLinks items={PRIMARY_ITEMS} /></nav>;
}

export function UtilityNav() {
  const { t } = useI18n();
  return (
    <nav className="nav utility-nav" aria-label={t('nav.workspaceAndHelp')}>
      <button type="button" onClick={() => window.dispatchEvent(new Event(SUPPORT_OPEN_EVENT))}>{icon.support}{t('nav.support')}</button>
      <NavLinks items={UTILITY_ITEMS} />
    </nav>
  );
}
