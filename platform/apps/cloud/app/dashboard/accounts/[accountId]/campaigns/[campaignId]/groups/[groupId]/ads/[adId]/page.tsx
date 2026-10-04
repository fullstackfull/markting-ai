import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, formatMoneyMinor } from '@/components/ui';
import { IntelMeta } from '@/components/intel';
import { MetricCard, EvidenceCard, StatusChip } from '@/components/kit';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { authorizeTenantAccount } from '@/lib/cloud/account-authz';
import { loadAd } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { RangeControl } from '@/components/range-control';
import { FreshnessBar } from '@/components/freshness-bar';
import { parseRangeParam } from '@/lib/cloud/date-range';
import { loadBusinessContext } from '@/lib/markting/business-context';

export const metadata = { title: 'Ad' };

/**
 * PHASE B (B9) — ad detail. Parent hierarchy breadcrumb (account ▸ campaign ▸ ad set/group ▸ ad), status,
 * the full KPI set (spend/impressions/clicks/CTR/CPC/conversions/CPA/ROAS), CPA trend, an evidence-backed
 * deterministic diagnosis, and the raw evidence. No multimodal/creative-media analysis (out of scope).
 * DEMO reads the seed; a live deployment returns the honest not-connected state like loadCampaign.
 */
export default async function AdPage({ params, searchParams }: { params: Promise<{ accountId: string; campaignId: string; groupId: string; adId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId, campaignId, groupId, adId } = await params;
  const tenant = await requireDashboardTenant();
  await authorizeTenantAccount(tenant, accountId);
  const { t, locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const T = (b: { en: string; ar: string }) => (locale === 'ar' ? b.ar : b.en);
  const sp = await searchParams;
  const rangeRaw = typeof sp.range === 'string' ? sp.range : undefined;
  const selection = parseRangeParam(rangeRaw);
  const rq = encodeURIComponent(rangeRaw ?? 'last_30_days');
  const [section, business] = await Promise.all([
    loadAd(tenant, accountId, campaignId, groupId, adId),
    loadBusinessContext(tenant.organizationId),
  ]);
  const demo = resolveRuntimeMode() === 'DEMO';

  const breadcrumb = (
    <p className="cell-sub" style={{ marginTop: -6, marginBottom: 8 }}>
      <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}?range=${rq}`} prefetch={false}>{L('Account', 'الحساب')}</Link>
      {' ▸ '}
      <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(campaignId)}?range=${rq}`} prefetch={false}>{section.found ? (section.campaignName ?? L('Campaign', 'الحملة')) : L('Campaign', 'الحملة')}</Link>
      {' ▸ '}
      <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(campaignId)}/groups/${encodeURIComponent(groupId)}?range=${rq}`} prefetch={false}>{section.found ? (section.adGroupName ?? groupId) : groupId}</Link>
      {' ▸ '}<span>{section.found ? section.name : adId}</span>
    </p>
  );

  if (!section.found) {
    // C0.1/C0.3 — DEMO seed is the complete universe; a not-found ad means the
    // campaign▸group▸ad chain does not hold (wrong-parent URL guess or unknown id) → true 404,
    // never a cross-tenant oracle. The soft not-connected card stays only for the live case.
    if (demo) notFound();
    return (
      <main className="page">
        <PageHeader title={t('adgroups.adFallback')} description={`${accountId} · ${adId}`} />
        {breadcrumb}
        <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />
        <section className="card"><div className="blocked-state" role="note"><strong>{t('adgroups.notConnectedTitle')}</strong><p className="cell-sub">{T(section.summary)}</p></div></section>
      </main>
    );
  }

  const k = section.kpis!;
  const cur = section.currency;
  const m = (v: number) => formatMoneyMinor(v, cur, locale);

  return (
    <main className="page">
      <PageHeader title={section.name ?? t('adgroups.adFallback')} description={`${accountId} · ${adId}`} />
      {breadcrumb}
      <RangeControl />
      <FreshnessBar selection={selection} timezone={business.timezone.value} source="DETERMINISTIC_ONLY" live={!demo} locale={locale} />
      <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{t('adgroups.performance')}</h2><StatusChip tone={section.status === 'active' ? 'good' : 'neutral'} label={`${t('adgroups.status')}: ${section.status}`} /></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <MetricCard label={L('Spend', 'الإنفاق')} value={m(k.spendMinor)} />
          <MetricCard label={L('Impressions', 'الظهور')} value={String(section.impressions ?? 0)} />
          <MetricCard label={L('Clicks', 'النقرات')} value={String(section.clicks ?? 0)} />
          <MetricCard label="CTR" value={`${k.ctr}%`} />
          <MetricCard label="CPC" value={m(k.cpcMinor)} />
          <MetricCard label={L('Conversions', 'التحويلات')} value={String(k.conversions)} />
          <MetricCard label="CPA" value={m(k.cpaMinor)} />
          <MetricCard label="ROAS" value={`${k.roas}×`} />
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>{t('adgroups.trend')}: {section.trend?.direction} / {section.trend?.state}</p>
        <p className="cell-sub">{t('adgroups.multimodalNote')}</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>{t('adgroups.diagnosis')}</h2></div>
        <p>{section.diagnosis ? T(section.diagnosis) : '—'}</p>
        {section.evidence && section.evidence.length > 0 && (
          <EvidenceCard title={t('adgroups.evidenceTitle')}>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>{section.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </EvidenceCard>
        )}
      </section>
    </main>
  );
}
