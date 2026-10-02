import { Empty, PageHeader, Provider, formatDate } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { PostgresFindingsStore } from '@/lib/cloud/repository';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Findings' };

const TONE: Record<string, string> = { critical: 'critical', warn: 'warn', info: 'neutral' };

export default async function FindingsPage() {
  const tenant = await requireDashboardTenant();
  const findings = await new PostgresFindingsStore(tenant.organizationId).list();
  const { t, tn, locale } = await getT();
  return (
    <main className="page">
      <PageHeader title={t('findings.title')} description={t('findings.description')} />
      <section className="card">
        {findings.length === 0 ? (
          <Empty title={t('findings.emptyTitle')} copy={t('findings.emptyCopy')} />
        ) : (
          <>
            <div className="card-head"><h2>{t('findings.auditFindings')}</h2><span className="card-note">{tn('findings.total', findings.length)}</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>{t('findings.colSeverity')}</th><th>{t('findings.colFinding')}</th><th>{t('findings.colProvider')}</th><th>{t('findings.colAccount')}</th><th>{t('findings.colStatus')}</th><th>{t('findings.colUpdated')}</th></tr></thead>
              <tbody>
                {findings.map((finding) => (
                  <tr key={finding.id}>
                    <td><span className={`status ${TONE[finding.severity] ?? 'neutral'}`}>{t(`findings.severity_${finding.severity}`)}</span></td>
                    <td><strong>{finding.title}</strong><div className="cell-sub">{finding.recommendation}</div></td>
                    <td><Provider name={finding.provider} /></td>
                    <td><span className="cell-sub" style={{ marginTop: 0 }}>{finding.accountId}</span></td>
                    <td><span className="status neutral">{t(`findings.status_${finding.status}`)}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(finding.updatedAt, locale)}</td>
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
