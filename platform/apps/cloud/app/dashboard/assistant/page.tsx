import { PageHeader } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { isDemoMode, marktingEnv } from '@/lib/markting/env';
import { AssistantChat } from './assistant-chat';

export const metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const tenant = await requireDashboardTenant();
  const demoMode = isDemoMode();
  const configured = Boolean(marktingEnv().MARKTING_ENGINE_TOKEN);
  return (
    <main className="page">
      <PageHeader
        title="Assistant"
        description="Ask about performance across your connected accounts. The assistant analyses and proposes; every change it suggests becomes a previewed operation on the Approvals page and nothing is written until someone approves it there."
      />
      {!configured ? <div className="error-callout">The analysis engine is not configured. Set MARKTING_ENGINE_URL and MARKTING_ENGINE_TOKEN on the server.</div> : null}
      {demoMode ? <div className="callout">Demo mode: synthetic accounts (Google, Meta, Reddit fixtures) and a scripted engine. No ad platform is contacted.</div> : null}
      <AssistantChat organizationId={tenant.organizationId} canWrite={tenant.role !== 'viewer'} demoMode={demoMode} />
    </main>
  );
}
