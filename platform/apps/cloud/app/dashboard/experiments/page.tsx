import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Experiments' };

export default async function ExperimentsPage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const [exp, scenario, response] = await Promise.all([
    loadSection(tenant, 'EXPERIMENT_SUGGEST', { locale }),
    loadSection(tenant, 'BUDGET_SCENARIO', { locale }),
    loadSection(tenant, 'SATURATION', { locale }),
  ]);
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  return (
    <main className="page">
      <PageHeader title={L('Experiments & Scenarios', 'التجارب والسيناريوهات')} description={L('Design experiments and review budget scenarios. Nothing launches automatically and no provider is mutated — review only.', 'صمّم التجارب وراجع سيناريوهات الميزانية. لا شيء يُطلق تلقائيًا ولا تُعدّل أي منصّة — للمراجعة فقط.')} />
      <IntelMeta locale={locale} trustTier={exp.trustTier} live={exp.result.trust.live} source={exp.source} />
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Experiment workbench', 'طاولة التجارب')}</h2></div>{exp.section?.kind === 'experiments' && <SectionView section={exp.section} locale={locale} />}</section>
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Budget scenario review', 'مراجعة سيناريو الميزانية')}</h2></div>{scenario.section?.kind === 'scenario' && <SectionView section={scenario.section} locale={locale} />}</section>
      <section className="card"><div className="card-head"><h2>{L('Saturation / marginal', 'التشبّع / الحدّي')}</h2></div>{response.section?.kind === 'response' && <SectionView section={response.section} locale={locale} />}</section>
    </main>
  );
}
