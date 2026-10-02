import { PageHeader } from '@/components/ui';
import { canAdminister, requireDashboardTenant } from '@/lib/cloud/dashboard';
import { env } from '@/lib/env';
import { AgentSetupGuide } from './agent-setup-guide';
import { ApiKeyManager } from './api-key-manager';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Agent access' };

export default async function AgentsPage() {
  const tenant = await requireDashboardTenant();
  const baseUrl = env().ADPORT_CLOUD_BASE_URL.replace(/\/$/, '');
  const { t } = await getT();
  return (
    <main className="page">
      <PageHeader title={t('agents.title')} description={t('agents.description')} />
      <div className="stack agent-access-stack">
        <AgentSetupGuide baseUrl={baseUrl} />
        <div className="grid-2">
          <section className="card">
            <div className="card-head"><h2>{t('agents.connectionDetails')}</h2><span className="card-note">{t('agents.streamableHttp')}</span></div>
            <div className="card-body stack">
              <p className="subhead">{t('agents.connectionCopy')}</p>
              <div className="code"><span>MCP</span>{baseUrl}/mcp</div>
              <p className="inline-note">{t('agents.noKeyRequired')}</p>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><h2>{t('agents.restFallback')}</h2><span className="card-note">{t('agents.manualKeyRequired')}</span></div>
            <div className="card-body stack">
              <div className="code"><span>GET</span>{baseUrl}/api/v1/accounts</div>
              <div className="code"><span>POST</span>{baseUrl}/api/v1/tools/&lt;tool&gt;</div>
              <p className="inline-note">{t('agents.restCopy')}</p>
            </div>
          </section>
        </div>
        <section className="card">
          <div className="card-head"><h2>{t('agents.credentials')}</h2><span className="card-note">{t('agents.credentialsNote')}</span></div>
          <ApiKeyManager organizationId={tenant.organizationId} canManage={canAdminister(tenant)} />
        </section>
      </div>
    </main>
  );
}
