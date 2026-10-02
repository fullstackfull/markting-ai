import { Empty, PageHeader, Provider, formatNumber } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { readReport } from '@/lib/cloud/reads';
import { EngineReports } from './engine-reports';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  const tenant = await requireDashboardTenant();
  const result = await readReport({ organizationId: tenant.organizationId, userId: tenant.userId, role: tenant.role, scopes: ['tools:read'] }, 'last_30_days');
  const rows = result.ok ? result.data.rows : [];
  const { t, locale } = await getT();
  const fmt = (value?: number) => formatNumber(value, locale);
  return (
    <main className="page">
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      {!result.ok ? <div className="error-callout">{t('reports.readFailed', { error: result.error })}</div> : null}
      {result.warnings.map((warning) => <div className="error-callout" key={`${warning.provider}:${warning.message}`}>{t('reports.partialRead', { message: warning.message })}</div>)}
      <EngineReports organizationId={tenant.organizationId} canRun={tenant.role !== 'viewer'} />
      <section className="card">
        {rows.length === 0 ? (
          <Empty
            title={t('reports.emptyTitle')}
            copy={result.connected ? t('reports.emptyConnected') : t('reports.emptyNotConnected')}
            href="/dashboard/connections"
            action={t('reports.manageConnections')}
          />
        ) : (
          <>
            <div className="card-head"><h2>{t('reports.campaigns')}</h2><span className="card-note">{t('reports.note', { rows: rows.length })}{result.ok && result.data.truncated ? t('reports.truncated') : ''}</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>{t('reports.campaign')}</th><th>{t('reports.provider')}</th><th>{t('reports.status')}</th><th className="numeric">{t('reports.spend')}</th><th className="numeric">{t('reports.impressions')}</th><th className="numeric">{t('reports.clicks')}</th><th className="numeric">{t('reports.conversions')}</th><th className="numeric">ROAS</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.provider}:${row.accountId}:${row.entity.id}`}>
                    <td><strong>{row.entity.name || row.entity.id}</strong><div className="cell-sub">{row.accountId}</div></td>
                    <td><Provider name={row.provider} /></td>
                    <td>{row.entity.status ? <span className={`status ${/paused|disabled|removed/i.test(row.entity.status) ? 'neutral' : ''}`}>{row.entity.status}</span> : '—'}</td>
                    <td className="numeric">{fmt(row.metrics.spend)}</td>
                    <td className="numeric">{fmt(row.metrics.impressions)}</td>
                    <td className="numeric">{fmt(row.metrics.clicks)}</td>
                    <td className="numeric">{fmt(row.metrics.conversions)}</td>
                    <td className="numeric">{fmt(row.metrics.roas)}×</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </section>
    </main>
  );
}
