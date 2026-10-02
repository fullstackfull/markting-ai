import { PageHeader } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { isDemoMode, marktingEnv } from '@/lib/markting/env';
import { AssistantChat } from './assistant-chat';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const tenant = await requireDashboardTenant();
  const demoMode = isDemoMode();
  const configured = Boolean(marktingEnv().MARKTING_ENGINE_TOKEN);
  const { t } = await getT();
  return (
    <main className="page">
      <PageHeader
        title={t('assistant.title')}
        description={t('assistant.description')}
      />
      {!configured ? <div className="error-callout">{t('assistant.notConfigured')}</div> : null}
      {demoMode ? <div className="callout">{t('assistant.demoMode')}</div> : null}
      <AssistantChat organizationId={tenant.organizationId} canWrite={tenant.role !== 'viewer'} demoMode={demoMode} />
    </main>
  );
}
