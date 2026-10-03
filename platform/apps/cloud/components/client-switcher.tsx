import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { isDemoMode } from '@/lib/markting/env';
import { SEED_PORTFOLIO } from '@/lib/markting/orchestrator/seed';

/**
 * Agency client switcher (Program 5). Switching is NAVIGATION to a client's account route, so the whole
 * page re-resolves server-side (tenant + account scope validated on each request) — there is no
 * client-side client state to leak, and browser back/forward is safe by construction. In a live
 * deployment the client list comes from the authenticated principal's workspace memberships (the
 * account route already validates account scope); in DEMO it is the seed portfolio. Renders the active
 * Agency › Client context and a per-client link. (Free-text client search is a later enhancement.)
 */
export async function ClientSwitcher({ activeAccountId }: { activeAccountId?: string }) {
  const { locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  if (!isDemoMode()) return null; // live: client scope comes from memberships; no demo portfolio shown
  const active = SEED_PORTFOLIO.find((c) => c.account.accountId === activeAccountId) ?? SEED_PORTFOLIO[0]!;
  return (
    <details className="client-switcher">
      <summary className="workspace-client" aria-label={L('Switch client', 'تبديل العميل')}>
        <span className="cell-sub">{L('Client', 'العميل')}</span>
        <strong>{active.name}</strong>
      </summary>
      <ul className="client-list">
        {SEED_PORTFOLIO.map((c) => (
          <li key={c.id}>
            <Link href={`/dashboard/accounts/${encodeURIComponent(c.account.accountId)}`} prefetch={false} aria-current={c.id === active.id ? 'true' : undefined}>
              {c.name} <span className="cell-sub">({c.reportingCurrency})</span>
            </Link>
          </li>
        ))}
        <li><Link href="/dashboard/agency" prefetch={false}>{L('All clients (portfolio)', 'كل العملاء (المحفظة)')}</Link></li>
      </ul>
    </details>
  );
}
