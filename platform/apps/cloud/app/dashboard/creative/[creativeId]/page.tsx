import Link from 'next/link';
import { notFound } from 'next/navigation';
import { decodeParams } from '@/lib/cloud/route-params';
import { PageHeader, formatMoneyMinor } from '@/components/ui';
import { IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadCreativeDetail } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';

export const metadata = { title: 'Creative detail' };

export default async function CreativeDetailPage({ params }: { params: Promise<{ creativeId: string }> }) {
  const { creativeId } = decodeParams(await params);
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const d = await loadCreativeDetail(tenant, creativeId);
  const demo = resolveRuntimeMode() === 'DEMO';
  const T = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  if (!d.found) {
    // C0.3 — DEMO seed is the complete creative universe; an unknown creative id is a true 404, not a
    // soft card. The not-connected card stays only for the genuine live-without-connections case.
    if (demo) notFound();
    return <main className="page"><PageHeader title={L('Creative', 'الإعلان')} description={creativeId} /><section className="card"><p className="cell-sub">{locale === 'ar' ? d.summary.ar : d.summary.en}</p></section></main>;
  }
  return (
    <main className="page">
      <PageHeader title={d.name ?? L('Creative', 'الإعلان')} description={`${d.hook} · ${d.angle} · ${d.format}`} />
      <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Media', 'الوسائط')}</h2></div>
        <p className="cell-sub">{L('Visual/video analysis', 'التحليل البصري/الفيديو')}: <span className="status warn">MULTIMODAL_NOT_CONFIGURED</span> — {L('no multimodal model wired; visual intelligence is not fabricated.', 'لا نموذج متعدد الوسائط؛ لا يُختلق التحليل البصري.')}</p>
      </section>
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Performance', 'الأداء')}</h2></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {([
            ['Spend', formatMoneyMinor(d.spendMinor, d.currency, locale)],
            ['Impr', String(d.impressions ?? '—')],
            ['Clicks', String(d.clicks ?? '—')],
            ['Conv', String(d.conversions ?? '—')],
            ['CTR%', String(d.ctr ?? '—')],
            ['CPC', formatMoneyMinor(d.cpcMinor, d.currency, locale)],
            ['CPA', formatMoneyMinor(d.cpaMinor, d.currency, locale)],
          ] as const).map(([k, v]) => <span key={k} className="status neutral">{k}: {v}</span>)}
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>{L('Lifecycle', 'دورة الحياة')}: {d.lifecycle} · {L('State', 'الحالة')}: {d.state} · {L('Cluster', 'العنقود')}: {d.cluster}</p>
      </section>
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Fatigue evidence', 'أدلة الإجهاد')}</h2><span className={`status ${d.fatigue === 'FATIGUE_SIGNAL' ? 'warn' : 'neutral'}`}>{d.fatigue}</span></div>
        <p className="cell-sub">{(d.fatigueEvidence ?? []).join(', ') || L('no fatigue signal', 'لا إشارة إجهاد')}</p>
      </section>
      {d.testIdea && <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Test idea', 'فكرة اختبار')}</h2></div><p>{T(d.testIdea.en, d.testIdea.ar)}</p></section>}
      {d.campaignId && <section className="card"><Link href={`/dashboard/accounts/${encodeURIComponent('sandbox:acc:ramadan')}/campaigns/${encodeURIComponent(d.campaignId)}`} prefetch={false} className="card-note">{L('Open linked campaign →', 'افتح الحملة المرتبطة ←')}</Link></section>}
    </main>
  );
}
