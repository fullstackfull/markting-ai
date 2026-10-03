import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection, loadWorkspaceIntelligence } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Executive' };

export default async function ExecutivePage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const [brief, commerce, forecast, dq] = await Promise.all([
    loadWorkspaceIntelligence(tenant, 'PROFITABILITY_DECLINE', { locale }),
    loadSection(tenant, 'COMMERCE_PROFIT', { locale }),
    loadSection(tenant, 'FORECAST', { locale }),
    loadSection(tenant, 'DATA_QUALITY', { locale }),
  ]);
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  return (
    <main className="page">
      <PageHeader title={L('Executive Summary', 'الملخّص التنفيذي')} description={L('Business performance, profit signal, major risks and data-quality warnings — drill into evidence as needed.', 'أداء العمل وإشارة الربح والمخاطر الكبرى وتحذيرات جودة البيانات — تعمّق في الأدلة عند الحاجة.')} />
      <IntelMeta locale={locale} trustTier={brief.trustTier} live={brief.result.trust.live} source={brief.source} />
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Business performance', 'أداء العمل')}</h2></div><p style={{ whiteSpace: 'pre-line' }}>{locale === 'ar' ? brief.text.ar : brief.text.en}</p></section>
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Profit', 'الربح')}</h2></div>{commerce.section?.kind === 'commerce' && <SectionView section={commerce.section} locale={locale} />}</section>
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Forecast', 'التوقّع')}</h2></div>{forecast.section?.kind === 'forecast' && <SectionView section={forecast.section} locale={locale} />}</section>
      <section className="card"><div className="card-head"><h2>{L('Data-quality warnings', 'تحذيرات جودة البيانات')}</h2></div>{dq.section?.kind === 'dataQuality' && <SectionView section={dq.section} locale={locale} />}</section>
    </main>
  );
}
