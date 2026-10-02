import { PageHeader } from '@/components/ui';
import type { DashboardTenant } from '@/lib/cloud/dashboard';
import { getT } from '@/lib/i18n/server';

/** Keep retired reviewer sessions isolated without serving any demo data or tools. */
export async function SyntheticReviewer(_props: { tenant: DashboardTenant }) {
  const { t } = await getT();
  return <main className="page">
    <PageHeader title={t('support.retiredTitle')} description={t('support.retiredCopy')} />
  </main>;
}
