import Link from 'next/link';
import { PageHeader, Empty } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadWorkspaceIntelligence } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/config';
import type { ContributingFactor, NextAction } from '@/lib/markting/orchestrator/envelope';

export const metadata = { title: 'Workspace' };

const SEVERITY_TONE: Record<string, string> = { CRITICAL: 'critical', ATTENTION: 'warn', WATCH: 'neutral', INFO: 'neutral' };
const NEXT_ACTION_TONE: Record<NextAction, string> = {
  ATTENTION: 'critical', INVESTIGATE: 'warn', REVIEW: 'warn', EXPERIMENT: 'neutral',
  MONITOR: 'neutral', NO_ACTION: 'neutral', INSUFFICIENT_EVIDENCE: 'neutral',
};

const L = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

function FactorCard({ factor, locale }: { factor: ContributingFactor; locale: Locale }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head">
        <h3 style={{ margin: 0 }}>{factor.domain}</h3>
        <span className={`status ${SEVERITY_TONE[factor.severity] ?? 'neutral'}`}>{factor.severity}</span>
      </div>
      <p style={{ marginTop: 6 }}>{locale === 'ar' ? factor.summary.ar : factor.summary.en}</p>
      <div className="cell-sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>{L(locale, 'Confidence', 'الثقة')}: {factor.confidence}</span>
        <span>{L(locale, 'Trust', 'الموثوقية')}: {factor.dataTrust}</span>
        {factor.materiality != null && <span>{L(locale, 'Materiality', 'الأهمية')}: {Math.round(factor.materiality * 100)}%</span>}
        <span>{L(locale, 'Priority', 'الأولوية')}: {factor.priority}</span>
      </div>
    </div>
  );
}

export default async function WorkspacePage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const answer = await loadWorkspaceIntelligence(tenant, 'DAILY_REVIEW', { locale });
  const { result } = answer;
  const factors = result.diagnosis.factors;

  return (
    <main className="page">
      <PageHeader
        title={L(locale, 'Needs attention', 'يحتاج انتباهًا')}
        description={L(locale, 'What changed, why, and what to do first — composed across your ad, commerce and creative signals.', 'ما الذي تغيّر ولماذا وما الذي تبدأ به — مُجمَّعًا عبر إشارات الإعلانات والتجارة والإبداع.')}
      />

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>{L(locale, 'Diagnosis', 'التشخيص')}</h2>
          <span className={`status ${NEXT_ACTION_TONE[result.nextAction]}`}>{result.nextAction}</span>
        </div>
        <p style={{ whiteSpace: 'pre-line' }}>{locale === 'ar' ? answer.text.ar : answer.text.en}</p>
        <div className="cell-sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <span>{L(locale, 'Trust', 'الموثوقية')}: {answer.trustTier}</span>
          <span>{L(locale, 'Answer source', 'مصدر الإجابة')}: {answer.source}</span>
          {!result.trust.live && <span className="status neutral">{L(locale, 'Demo / synthetic data', 'بيانات تجريبية')}</span>}
        </div>
        {answer.nextBestQuestion && (
          <p className="cell-sub" style={{ marginTop: 8 }}>
            {L(locale, 'Next best question', 'السؤال التالي الأفضل')}: {locale === 'ar' ? answer.nextBestQuestion.ar : answer.nextBestQuestion.en}
          </p>
        )}
      </section>

      <section style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10 }}>{L(locale, 'Contributing factors (ranked)', 'العوامل المساهمة (مرتبة)')}</h2>
        {factors.length === 0
          ? <Empty title={L(locale, 'Nothing needs attention', 'لا شيء يحتاج انتباهًا')} copy={L(locale, 'No material issues from the available evidence. Connect providers and a store for a full picture.', 'لا مشكلات جوهرية من الأدلة المتاحة. اربط المنصّات ومتجرًا للحصول على صورة كاملة.')} />
          : factors.map((f) => <FactorCard key={f.key} factor={f} locale={locale} />)}
      </section>

      <section style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>{L(locale, 'Recommendations', 'التوصيات')}</h2>
          <Link href="/dashboard/recommendations" prefetch={false} className="card-note">{L(locale, 'Open Recommendation Center →', 'افتح مركز التوصيات ←')}</Link>
        </div>
        {result.recommendations.length === 0
          ? <Empty title={L(locale, 'No recommendations yet', 'لا توصيات بعد')} copy={L(locale, 'Recommendations appear here when the evidence supports a review.', 'تظهر التوصيات هنا عندما تدعم الأدلة إجراء مراجعة.')} />
          : (
            <div className="card">
              <div className="table-wrap"><table>
                <thead><tr><th>{L(locale, 'Domain', 'المجال')}</th><th>{L(locale, 'Recommendation', 'التوصية')}</th><th>{L(locale, 'Risk', 'المخاطرة')}</th><th>{L(locale, 'Confidence', 'الثقة')}</th></tr></thead>
                <tbody>
                  {result.recommendations.map((r) => (
                    <tr key={r.recommendationId}>
                      <td><span className="status neutral">{r.domain}</span></td>
                      <td><strong>{r.category}</strong><div className="cell-sub">{locale === 'ar' ? r.reasoning.ar : r.reasoning.en}</div></td>
                      <td>{r.risk}</td>
                      <td>{r.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
      </section>

      <section className="card">
        <h2>{L(locale, 'Domain coverage', 'تغطية المجالات')}</h2>
        <div className="cell-sub" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          {result.domains.map((d) => (
            <span key={d.domain} className={`status ${d.state === 'CONTRIBUTED' ? 'neutral' : 'warn'}`}>{d.domain}: {d.state}</span>
          ))}
        </div>
      </section>
    </main>
  );
}
