import { PageHeader, Empty } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadWorkspaceIntelligence } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/config';

export const metadata = { title: 'Recommendations' };

const RISK_TONE: Record<string, string> = { CRITICAL: 'critical', HIGH: 'critical', MODERATE: 'warn', LOW: 'neutral' };
const L = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export default async function RecommendationsPage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const answer = await loadWorkspaceIntelligence(tenant, 'PROFITABILITY_DECLINE', { locale });
  const recs = answer.result.recommendations;

  return (
    <main className="page">
      <PageHeader
        title={L(locale, 'Recommendation Center', 'مركز التوصيات')}
        description={L(locale, 'One review queue across media, creative, commerce and optimization. Every item is review-only — accepting never changes a provider; a change still requires the governed preview and human approval.', 'قائمة مراجعة واحدة عبر الإعلانات والإبداع والتجارة والتحسين. كل عنصر للمراجعة فقط — القبول لا يغيّر أي منصّة؛ أي تغيير يتطلب المعاينة المُدارة وموافقة بشرية.')}
      />
      {recs.length === 0 ? (
        <section className="card"><Empty title={L(locale, 'No recommendations', 'لا توجد توصيات')} copy={L(locale, 'When the evidence supports a review, recommendations from every domain appear here.', 'عندما تدعم الأدلة إجراء مراجعة، تظهر هنا توصيات من كل مجال.')} /></section>
      ) : (
        recs.map((r) => (
          <section className="card" key={r.recommendationId} style={{ marginBottom: 12 }}>
            <div className="card-head">
              <h2 style={{ margin: 0, fontSize: '1rem' }}>{r.category}</h2>
              <span className={`status ${RISK_TONE[r.risk] ?? 'neutral'}`}>{L(locale, 'Risk', 'مخاطرة')}: {r.risk}</span>
            </div>
            <p style={{ marginTop: 6 }}>{locale === 'ar' ? r.reasoning.ar : r.reasoning.en}</p>
            <div className="cell-sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>{L(locale, 'Domain', 'المجال')}: {r.domain}</span>
              <span>{L(locale, 'Confidence', 'الثقة')}: {r.confidence}</span>
              <span>{L(locale, 'Trust', 'الموثوقية')}: {r.dataTrust}</span>
              <span>{L(locale, 'Expected', 'المتوقع')}: {r.expectedImpact}</span>
              <span>{L(locale, 'Status', 'الحالة')}: {r.status}</span>
            </div>
            {r.historicalContext && (
              <p className="cell-sub" style={{ marginTop: 6 }}>{L(locale, 'History', 'السجل')}: {locale === 'ar' ? r.historicalContext.ar : r.historicalContext.en}</p>
            )}
            <details style={{ marginTop: 8 }}>
              <summary className="cell-sub">{L(locale, 'Inspect evidence', 'افحص الأدلة')}</summary>
              <pre style={{ overflowX: 'auto', fontSize: '0.8rem', marginTop: 6 }}>{JSON.stringify(r.evidenceDetail, null, 2)}</pre>
            </details>
            <p className="cell-sub" style={{ marginTop: 8 }}>
              {L(locale, 'Review only — accepting records intent for a future governed preview; it does not change anything.', 'للمراجعة فقط — القبول يسجّل النية لمعاينة مُدارة لاحقًا؛ ولا يغيّر أي شيء.')}
            </p>
          </section>
        ))
      )}
    </main>
  );
}
