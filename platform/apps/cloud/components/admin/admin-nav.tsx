'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const ADMIN_NAV: Array<{ href: string; label: string }> = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/organizations', label: 'Organizations' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/billing', label: 'Plans & Billing' },
  { href: '/admin/ai', label: 'AI Operations' },
  { href: '/admin/providers', label: 'Providers' },
  { href: '/admin/commerce', label: 'Commerce' },
  { href: '/admin/system', label: 'System Health' },
  { href: '/admin/governance', label: 'Governance & Safety' },
  { href: '/admin/security', label: 'Security & Audit' },
  { href: '/admin/support', label: 'Support' },
  { href: '/admin/flags', label: 'Feature Flags' },
  { href: '/admin/settings', label: 'Settings' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav">
      {ADMIN_NAV.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
