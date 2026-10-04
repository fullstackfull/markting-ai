'use client';

import { useEffect, useState } from 'react';
import { Empty, Metric, Provider, formatNumber, formatMoney } from '@/components/ui';
import { useI18n } from '@/components/i18n-provider';
import { providerLabel } from '@/lib/cloud/providers';
import { summarizeLiveRows } from '@/lib/cloud/live-summary';

interface Summary {
  rows: Array<{ provider: string; accountId: string; currency?: string; entity: { id: string; name: string; status?: string }; metrics: Record<string, number> }>;
  truncated?: boolean;
  warnings?: Array<{ provider: string; message: string }>;
}

/**
 * Live seven-day read across every connected provider. Rendered client-side so
 * the overview shell paints immediately while provider APIs respond.
 */
export function LiveData({ organizationId, connected }: { organizationId: string; connected: boolean }) {
  const { t, locale } = useI18n();
  const fmt = (value?: number) => formatNumber(value, locale);
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!connected) return;
    void fetch(`/api/dashboard/summary?organization_id=${organizationId}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as Summary & { error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Unable to load provider data.');
        setSummary(body);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [connected, organizationId]);

  const rows = summary?.rows ?? [];
  // A1: conversions/ROAS per provider (never blended across providers); spend per currency (never
  // blended across currencies); impressions/clicks are raw counts and safe to sum. See summarizeLiveRows.
  const agg = summarizeLiveRows(rows);
  const totals = { impressions: agg.impressions, clicks: agg.clicks };
  const currencies = agg.spendByCurrency;
  const singleCurrency = currencies.length === 1 ? currencies[0]! : undefined;
  const spendDisplay = singleCurrency
    ? `${fmt(singleCurrency.spend)}${singleCurrency.currency ? ` ${singleCurrency.currency}` : ''}`
    : currencies.map((c) => `${fmt(c.spend)}${c.currency ? ` ${c.currency}` : ''}`).join(' · ') || fmt(0);

  const providers = agg.perProvider;
  const multiProvider = providers.length > 1;
  const conversionsDisplay = providers.length === 0 ? '—'
    : providers.map((m) => multiProvider ? `${providerLabel(m.provider)} ${fmt(m.conversions)}` : fmt(m.conversions)).join(' · ');
  const roasDisplay = providers.length === 0 ? '—'
    : providers.map((m) => {
        const r = m.roas === undefined ? '—' : `${fmt(m.roas)}×`;
        return multiProvider ? `${providerLabel(m.provider)} ${r}` : r;
      }).join(' · ');
  const loading = connected && !summary && !error;

  return (
    <>
      {error ? <div className="error-callout">{t('overview.readFailed', { error })}</div> : null}
      {summary?.warnings?.map((warning) => (
        <div className="error-callout" key={`${warning.provider}:${warning.message}`}>{t('overview.partialRead', { message: warning.message })}</div>
      ))}
      <section className="metrics" aria-label={t('overview.performanceSummary')} aria-busy={loading}>
        <Metric label={t('overview.spend')} value={loading ? '…' : spendDisplay} foot={t('overview.spendFoot')} />
        <Metric label={t('overview.clicks')} value={loading ? '…' : fmt(totals.clicks)} foot={loading ? t('common.loading') : t('overview.impressionsFoot', { impressions: fmt(totals.impressions) })} />
        <Metric label={t('overview.conversions')} value={loading ? '…' : conversionsDisplay} foot={t('overview.conversionsFoot')} />
        <Metric label="ROAS" value={loading ? '…' : roasDisplay} foot={t('overview.roasFoot')} />
      </section>
      <section className="card">
        <div className="card-head"><h2>{t('overview.campaignActivity')}</h2><span className="card-note">{t('overview.activityNote')}{summary?.truncated ? t('overview.truncated') : ''}</span></div>
        {loading ? (
          <div className="card-body">
            {[0, 1, 2, 3].map((i) => <div className="skeleton-line" style={{ width: '100%', height: '0.7rem', marginBottom: i === 3 ? 0 : '1.05rem', opacity: 1 - i * 0.2 }} key={i} />)}
          </div>
        ) : rows.length === 0 ? (
          <Empty title={t('overview.noRowsTitle')} copy={t('overview.noRowsCopy')} />
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('overview.campaign')}</th><th>{t('overview.provider')}</th><th>{t('overview.status')}</th><th className="numeric">{t('overview.spend')}</th><th className="numeric">{t('overview.clicks')}</th><th className="numeric">{t('overview.conv')}</th><th className="numeric">ROAS</th></tr></thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={`${row.provider}:${row.accountId}:${row.entity.id}`}>
                  <td><strong>{row.entity.name || row.entity.id}</strong><div className="cell-sub">{row.accountId}</div></td>
                  <td><Provider name={row.provider} /></td>
                  <td>{row.entity.status ? <span className={`status ${/paused|disabled|removed/i.test(row.entity.status) ? 'neutral' : ''}`}>{row.entity.status}</span> : '—'}</td>
                  <td className="numeric">{row.currency ? formatMoney(row.metrics.spend ?? 0, row.currency, locale) : fmt(row.metrics.spend)}</td>
                  <td className="numeric">{fmt(row.metrics.clicks)}</td>
                  <td className="numeric">{fmt(row.metrics.conversions)}</td>
                  <td className="numeric">{fmt(row.metrics.roas)}×</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
