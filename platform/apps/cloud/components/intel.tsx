import Link from 'next/link';
import type { Locale } from '@/lib/i18n/config';
import type { BiText } from '@/lib/markting/intelligence/decision-model';
import type { AnswerSection } from '@/lib/markting/orchestrator/sections';

/**
 * Coherence-2 — a reusable server component that renders any orchestrator AnswerSection consistently
 * across the persona surfaces (account, campaign, creative, commerce, experiments, agency, executive,
 * data-quality). Bilingual via BiText + locale; no client JS. Evidence/values are always inspectable.
 */
const T = (locale: Locale, b: BiText): string => (locale === 'ar' ? b.ar : b.en);
const L = (locale: Locale, en: string, ar: string): string => (locale === 'ar' ? ar : en);

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="cell-sub" style={{ display: 'flex', gap: 8 }}><strong style={{ minWidth: 160 }}>{label}</strong><span>{value}</span></div>;
}

export function SectionView({ section, locale }: { section: AnswerSection; locale: Locale }) {
  switch (section.kind) {
    case 'pacing':
      return <div><KV label={L(locale, 'Status', 'الحالة')} value={<span className="status neutral">{section.result.status}</span>} /><KV label={L(locale, 'Expected %', 'المتوقع %')} value={`${Math.round(section.result.expectedFraction * 100)}%`} /><KV label={L(locale, 'Actual %', 'الفعلي %')} value={`${Math.round(section.result.actualFraction * 100)}%`} /><KV label={L(locale, 'Projected', 'المتوقع')} value={section.result.projectedOverUnderPct == null ? L(locale, 'withheld (too early)', 'محجوب (مبكر جدًا)') : `${Math.round(section.result.projectedOverUnderPct)}%`} /></div>;
    case 'forecast':
      return <div><KV label={L(locale, 'Horizon', 'الأفق')} value={`${section.horizonDays}d`} /><KV label={L(locale, 'Spend', 'الإنفاق')} value={`${section.spend.estimate} (${section.spend.low}–${section.spend.high}, ${section.spend.confidence})`} /><KV label={L(locale, 'Conversions', 'التحويلات')} value={`${section.conversions.estimate}`} /><KV label="CPA" value={`${section.cpa.estimate}`} /></div>;
    case 'anomaly':
      return <div><KV label={L(locale, 'Actionable', 'قابل للتنفيذ')} value={section.report.actionable ? L(locale, 'yes', 'نعم') : L(locale, 'no', 'لا')} />{section.report.top && <KV label={L(locale, 'Top point', 'أبرز نقطة')} value={`idx ${section.report.top.index}, z=${section.report.top.z}, ${section.report.top.pct ?? '—'}%`} />}</div>;
    case 'trend':
      return <div><KV label="CPA" value={`${T(locale, section.cpa.label)} (${section.cpa.direction})`} /><KV label={L(locale, 'Spend', 'الإنفاق')} value={`${section.spend.direction}, ${section.spend.state}`} /></div>;
    case 'response':
      return <div><KV label={L(locale, 'Curve', 'المنحنى')} value={section.curve.form} /><KV label={L(locale, 'Saturation', 'التشبّع')} value={T(locale, section.saturation.label)} /><KV label={L(locale, 'Marginal CPA', 'CPA الحدّي')} value={section.marginal.marginalCpa ?? section.marginal.reason ?? '—'} /></div>;
    case 'scaling':
      return <table><thead><tr><th>{L(locale, 'Campaign', 'الحملة')}</th><th>{L(locale, 'State', 'الحالة')}</th></tr></thead><tbody>{section.rows.map((r) => <tr key={r.campaignId}><td>{r.name}</td><td><span className="status neutral">{r.result.state}</span></td></tr>)}</tbody></table>;
    case 'scenario':
      return <div>{([['Conservative', section.conservative], ['Balanced', section.balanced], ['Aggressive (review)', section.aggressiveReview]] as const).map(([name, res]) => <div key={name} style={{ marginBottom: 8 }}><strong>{name}</strong><div className="cell-sub">{res.moves.length ? res.moves.map((m) => `${m.candidateId.split(':').pop()} ${m.direction} ${m.deltaMinor} ${m.currency} (${m.confidence})`).join('; ') : L(locale, 'no responsible move', 'لا تحرّك مسؤول')}</div></div>)}</div>;
    case 'creative':
      return <table><thead><tr><th>{L(locale, 'Creative', 'الإعلان')}</th><th>{L(locale, 'Hook', 'العنوان')}</th><th>CTR</th><th>{L(locale, 'State', 'الحالة')}</th><th>{L(locale, 'Fatigue', 'الإجهاد')}</th><th>{L(locale, 'Spend %', 'الإنفاق %')}</th></tr></thead><tbody>{section.rows.map((r) => <tr key={r.id}><td><Link href={`/dashboard/creative/${encodeURIComponent(r.id)}`} prefetch={false}>{r.name}</Link></td><td>{r.hook}</td><td>{r.ctr}%</td><td><span className="status neutral">{r.state}</span></td><td>{r.fatigue}</td><td>{r.spendSharePct}%</td></tr>)}</tbody></table>;
    case 'commerce':
      return section.available
        ? <div><KV label={L(locale, 'Refund rate', 'نسبة الاسترداد')} value={`${section.refundRatePct}%`} /><KV label="MER" value={section.mer?.value ?? L(locale, 'UNKNOWN', 'غير معروف')} /><KV label={L(locale, 'Contribution margin', 'هامش المساهمة')} value={section.margin?.notComputableReason ? L(locale, 'UNKNOWN (COGS missing)', 'غير معروف (COGS مفقود)') : `${section.margin?.contributionMarginPct}%`} /><KV label={L(locale, 'Reconciliation', 'التسوية')} value={`${section.reconciliation?.state} (${section.reconciliation?.sampleSufficiency})`} /><KV label={L(locale, 'AOV change', 'تغيّر متوسط الطلب')} value={section.aovChangePct == null ? '—' : `${section.aovChangePct}%`} /></div>
        : <p className="cell-sub">{section.note && T(locale, section.note)}</p>;
    case 'outcomes':
      return <table><thead><tr><th>{L(locale, 'Recommendation', 'التوصية')}</th><th>{L(locale, 'Status', 'الحالة')}</th><th>{L(locale, 'Outcome', 'النتيجة')}</th><th>{L(locale, 'Causality', 'السببية')}</th></tr></thead><tbody>{section.rows.map((r) => <tr key={r.recommendationId}><td>{T(locale, r.title)}</td><td>{r.status}{r.executed ? '' : ` (${L(locale, 'not executed', 'لم يُنفّذ')})`}</td><td>{r.outcomeClass}{r.contamination.length ? ` ⚠ ${r.contamination.join(',')}` : ''}</td><td>{r.causalStance}</td></tr>)}</tbody></table>;
    case 'memory':
      return <table><thead><tr><th>{L(locale, 'Item', 'العنصر')}</th><th>{L(locale, 'Source', 'المصدر')}</th><th>{L(locale, 'Trust', 'الموثوقية')}</th><th>{L(locale, 'Date', 'التاريخ')}</th></tr></thead><tbody>{section.rows.map((r) => <tr key={r.key}><td>{T(locale, r.value)}</td><td>{r.source}</td><td>{r.trust}</td><td>{r.dateIso}{r.revoked ? ` (${L(locale, 'revoked', 'ملغى')})` : ''}</td></tr>)}</tbody></table>;
    case 'experiments':
      return <div>{section.rows.map((r) => <div key={r.id} style={{ marginBottom: 8 }}><strong>{T(locale, r.title)}</strong> <span className="status neutral">{r.state}</span> <span className="status neutral">{r.readiness}</span><div className="cell-sub">{T(locale, r.hypothesis)}</div></div>)}</div>;
    case 'dataQuality':
      return <div>{section.issues.length ? section.issues.map((i) => <div key={i.code} className="cell-sub"><span className={`status ${i.severity === 'CRITICAL' ? 'critical' : 'warn'}`}>{i.code}</span> {T(locale, i.label)}</div>) : <p className="cell-sub">{L(locale, 'No data-quality issues.', 'لا مشكلات جودة بيانات.')}</p>}</div>;
    case 'portfolio':
      return <div><table><thead><tr><th>{L(locale, 'Client', 'العميل')}</th><th>{L(locale, 'Account', 'الحساب')}</th><th>{L(locale, 'Currency', 'العملة')}</th><th>{L(locale, 'Attention', 'الانتباه')}</th><th>{L(locale, 'Why', 'السبب')}</th></tr></thead><tbody>{section.rows.map((r) => <tr key={r.clientId}><td><strong>{r.clientName}</strong></td><td><Link href={`/dashboard/accounts/${encodeURIComponent(r.accountId)}`} prefetch={false}>{r.accountId}</Link></td><td>{r.currency}</td><td><span className={`status ${r.attentionScore >= 50 ? 'critical' : r.attentionScore >= 20 ? 'warn' : 'neutral'}`}>{r.attentionScore}</span></td><td className="cell-sub">{r.reasons.map((x) => T(locale, x)).join('; ') || '—'}</td></tr>)}</tbody></table><p className="cell-sub" style={{ marginTop: 8 }}>{T(locale, section.note)}</p></div>;
    case 'breakdown':
      return <div><KV label={L(locale, 'Provider', 'المزوّد')} value={section.provider} />{section.analyses.filter((a) => a.supported).map((a) => <div key={a.dimension} className="cell-sub"><strong>{a.dimension}</strong>: {a.concentration ?? '—'} (HHI {a.spendHHI ?? '—'}){a.efficiencySpread ? `, best ${a.efficiencySpread.best.value} / worst ${a.efficiencySpread.worst.value}` : a.protectedDimension ? ` — ${L(locale, 'protected: reported, never a targeting cut', 'محمي: يُعرض ولا يُستخدم للاستبعاد')}` : ''}</div>)}</div>;
    case 'campaign':
      if (!section.found || !section.kpis) return <p className="cell-sub">{T(locale, section.summary)}</p>;
      return <div>
        <div className="cell-sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <span>{L(locale, 'Role', 'الدور')}: {section.role}</span><span>{L(locale, 'Currency', 'العملة')}: {section.currency}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          {([['Spend', section.kpis.spendMinor], ['Conv', section.kpis.conversions], ['CPA', section.kpis.cpaMinor], ['ROAS', section.kpis.roas], ['CTR%', section.kpis.ctr], ['CPM', section.kpis.cpmMinor], ['CPC', section.kpis.cpcMinor]] as const).map(([k, v]) => <span key={k} className="status neutral">{k}: {v}</span>)}
        </div>
        <KV label={L(locale, 'Pacing', 'الوتيرة')} value={section.pacing?.status} />
        <KV label={L(locale, 'CPA trend', 'اتجاه CPA')} value={`${section.trend?.direction} / ${section.trend?.state}`} />
        <KV label={L(locale, 'Scaling', 'التوسّع')} value={section.scaling?.state} />
        <KV label={L(locale, 'Creative fatigue', 'إجهاد الإبداع')} value={section.fatigue} />
        <div className="cell-sub" style={{ marginTop: 8 }}>{L(locale, 'Current vs previous half', 'النصف الحالي مقابل السابق')}: {(section.comparison ?? []).map((c) => `${c.metric} ${c.direction}`).join(', ')}</div>
      </div>;
    case 'crossChannel':
      return <div><KV label={L(locale, 'ROAS comparability', 'قابلية مقارنة ROAS')} value={section.roas.comparability.state} /><KV label={L(locale, 'Ranking', 'الترتيب')} value={(section.roas.ranking ?? []).map((r) => `${r.provider} ${r.value}`).join(' > ') || L(locale, 'not comparable', 'غير قابل للمقارنة')} />{section.roas.caveat && <p className="cell-sub">{T(locale, section.roas.caveat)}</p>}</div>;
    default:
      return null;
  }
}

/** A standard header strip for a surface: freshness + currency + trust + demo marker. */
export function IntelMeta({ locale, trustTier, live, source }: { locale: Locale; trustTier: string; live: boolean; source?: string }) {
  return (
    <div className="cell-sub" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
      <span>{L(locale, 'Trust', 'الموثوقية')}: {trustTier}</span>
      {source && <span>{L(locale, 'Answer source', 'مصدر الإجابة')}: {source}</span>}
      {!live && <span className="status neutral">{L(locale, 'Demo / synthetic data', 'بيانات تجريبية')}</span>}
    </div>
  );
}
