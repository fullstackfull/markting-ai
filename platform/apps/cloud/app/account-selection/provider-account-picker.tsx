'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Account } from '@adport/core';
import { Provider } from '@/components/ui';
import { safeReturnPath } from '@/lib/return-path';
import { useI18n } from '@/components/i18n-provider';

export function ProviderAccountPicker({ organizationId, selectionId, provider, accounts, initialSelectedIds, pages }: {
  organizationId: string; selectionId: string; provider: string;
  accounts: Account[]; initialSelectedIds: string[];
  pages?: Array<{ id: string; name: string; category?: string }>;
}) {
  const router = useRouter();
  const { t, tn } = useI18n();
  const singleAccount = accounts.length === 1;
  const [selected, setSelected] = useState(() => new Set(initialSelectedIds.filter(id => accounts.some(account => account.id === id))));
  const [query, setQuery] = useState('');
  const [selectedPages, setSelectedPages] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const visible = accounts.filter(account => `${account.name} ${account.id}`.toLowerCase().includes(query.trim().toLowerCase()));

  function save(accountIds = [...selected]) {
    setError(undefined);
    startTransition(async () => {
      try {
        const response = await fetch('/api/account-selection', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId, selectionId, accountIds,
            ...(provider === 'meta' && pages !== undefined ? { pageIds: [...selectedPages] } : {}),
          }),
        });
        const body = await response.json() as { error?: string; returnPath?: string };
        if (!response.ok) { setError(body.error ?? t('accounts.saveFailed')); return; }
        router.replace(safeReturnPath(body.returnPath ?? '/dashboard/accounts'));
        router.refresh();
      } catch { setError(t('accounts.saveFailedNetwork')); }
    });
  }

  return <section className="card">
    <div className="card-head"><h2><Provider name={provider} /></h2><span className="card-note" aria-live="polite">{singleAccount ? t('accounts.oneAvailable') : t('accounts.selectedOf', { selected: selected.size, total: accounts.length })}</span></div>
    {!singleAccount && accounts.length > 0 ? <div className="account-picker-toolbar">
      <label className="account-picker-search">{t('accounts.searchAccounts')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('accounts.searchPlaceholder')} /></label>
      <button type="button" className="button secondary small" disabled={pending || !accounts.length} onClick={() => setSelected(new Set(accounts.map(account => account.id)))}>{t('accounts.selectAll')}</button>
      <button type="button" className="button secondary small" disabled={pending || !selected.size} onClick={() => setSelected(new Set())}>{t('accounts.clearSelection')}</button>
    </div> : null}
    {error ? <div role="alert" className="error-callout">{error}</div> : null}
    {visible.length ? <div className="table-wrap"><table>
      <thead><tr>{!singleAccount ? <th>{t('accounts.colAdd')}</th> : null}<th>{t('accounts.colAccount')}</th><th>{t('accounts.colCurrency')}</th><th>{t('accounts.colStatus')}</th></tr></thead>
      <tbody>{visible.map(account => <tr key={account.id}>
        {!singleAccount ? <td><input type="checkbox" aria-label={t('accounts.addAccountAria', { name: account.name, id: account.id })} checked={selected.has(account.id)} disabled={pending} onChange={event => {
          const checked = event.target.checked;
          setSelected(current => { const next = new Set(current); if (checked) next.add(account.id); else next.delete(account.id); return next; });
        }} /></td> : null}
        <td><strong>{account.name}</strong><div className="cell-sub">{account.id}</div></td>
        <td>{account.currency ?? t('common.none')}</td><td><span className="status neutral">{account.status ?? t('accounts.statusAvailable')}</span></td>
      </tr>)}</tbody>
    </table></div> : <div className="empty"><h3>{accounts.length ? t('accounts.noMatchingTitle') : t('accounts.noneReturnedTitle')}</h3><p>{accounts.length ? t('accounts.noMatchingCopy') : t('accounts.noneReturnedCopy')}</p></div>}
    {provider === 'meta' && pages !== undefined ? <section aria-labelledby="meta-pages-heading">
      <div className="card-head"><h2 id="meta-pages-heading">{t('accounts.facebookPages')}</h2><span className="card-note" aria-live="polite">{t('accounts.selectedOf', { selected: selectedPages.size, total: pages.length })}</span></div>
      <p className="inline-note" style={{ padding: '0 1.5rem' }}>{t('accounts.pagesCopy')}</p>
      {pages.length ? <div className="table-wrap"><table>
        <thead><tr><th>{t('accounts.colAllow')}</th><th>{t('accounts.colPage')}</th><th>{t('accounts.colCategory')}</th></tr></thead>
        <tbody>{pages.map(page => <tr key={page.id}>
          <td><input type="checkbox" aria-label={t('accounts.allowPageAria', { name: page.name, id: page.id })} checked={selectedPages.has(page.id)} disabled={pending}
            onChange={event => { const checked = event.target.checked; setSelectedPages(current => { const next = new Set(current); if (checked) next.add(page.id); else next.delete(page.id); return next; }); }} /></td>
          <td><strong>{page.name}</strong><div className="cell-sub">{page.id}</div></td><td>{page.category ?? t('common.none')}</td>
        </tr>)}</tbody>
      </table></div> : <p className="inline-note" style={{ padding: '0 1.5rem' }}>{t('accounts.noPagesReturned')}</p>}
      {!selectedPages.size ? <p className="inline-note" style={{ padding: '0 1.5rem' }}>{t('accounts.noPagesSelected')}</p> : null}
    </section> : null}
    <div className="account-picker-footer">
      <p className="inline-note">{singleAccount ? t('accounts.footerConfirm') : t('accounts.footerOnlySelected')} {t('accounts.footerInactive')}</p>
      {!singleAccount && !selected.size && accounts.length ? <p className="inline-note">{t('accounts.footerEmptyWarning')}</p> : null}
      <button type="button" className="button" disabled={pending} onClick={() => save(singleAccount ? accounts.map(account => account.id) : [...selected])}>{pending ? t('accounts.saving') : provider === 'meta' && pages !== undefined ? t('accounts.saveAccountsAndPages') : singleAccount ? t('accounts.addAccount') : selected.size ? tn('accounts.saveSelected', selected.size) : t('accounts.continueWithout')}</button>
    </div>
  </section>;
}
