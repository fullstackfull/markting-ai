import { Empty, PageHeader, Provider, formatDate } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { listAuditEvents } from '@/lib/cloud/repository';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Audit log' };

const TONE: Record<string, string> = { rejected: 'critical', revoked: 'warn', deletion_requested: 'critical', note: 'neutral', member_removed: 'warn', api_key_revoked: 'warn' };
// Events with a translated label; anything else falls back to the humanized event name.
const KNOWN_EVENTS = new Set(['validated', 'applied', 'rejected', 'note', 'connected', 'revoked', 'api_key_created', 'api_key_revoked', 'member_invited', 'member_role_updated', 'member_removed', 'settings_updated', 'deletion_requested', 'subscription_updated', 'account_access_updated']);

export default async function AuditPage() {
  const tenant = await requireDashboardTenant();
  const entries = await listAuditEvents(tenant.organizationId, 150);
  const { t, tn, locale } = await getT();
  return (
    <main className="page">
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <section className="card">
        {entries.length === 0 ? (
          <Empty title={t('audit.emptyTitle')} copy={t('audit.emptyCopy')} />
        ) : (
          <>
            <div className="card-head"><h2>{t('audit.recentEvents')}</h2><span className="card-note">{tn('audit.latestEntries', entries.length)}</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>{t('audit.colTime')}</th><th>{t('audit.colEvent')}</th><th>{t('audit.colProvider')}</th><th>{t('audit.colSummary')}</th><th>{t('audit.colActor')}</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(entry.createdAt, locale)}</td>
                    <td><span className={`status ${TONE[entry.event] ?? ''}`}>{KNOWN_EVENTS.has(entry.event) ? t(`audit.event_${entry.event}`) : entry.event.replaceAll('_', ' ')}</span></td>
                    <td>{entry.provider === 'cloud' ? <span className="cell-sub" style={{ marginTop: 0 }}>{t('audit.cloud')}</span> : <Provider name={entry.provider} />}</td>
                    <td>{entry.summary}<div className="cell-sub">{entry.tool} · {entry.accountId}</div></td>
                    <td><span className="cell-sub" style={{ marginTop: 0 }}>{entry.apiKeyId ? t('audit.actorApiKey') : entry.actorUserId ? t('audit.actorMember') : t('audit.actorSystem')}</span></td>
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
