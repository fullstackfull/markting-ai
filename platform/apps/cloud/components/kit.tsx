import Link from 'next/link';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader, Empty } from './ui';

/**
 * Hardening Program 31/32 — the formalized design-system kit: the small set of presentational
 * primitives every intelligence surface is built from, with ONE status vocabulary so red/yellow/green
 * is never overloaded. Every status/badge renders its meaning as TEXT (a word + a dot), so identity is
 * never color-alone — colorblind-safe and screen-reader-legible by construction. These are server
 * components (no client JS). PageHeader/EmptyState are re-exported from ui.tsx so there is one import.
 */
const L = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export { PageHeader };
export const EmptyState = Empty;

/** The single status tone scale. 'neutral' is informational — NOT a success/failure color. */
export type Tone = 'good' | 'warn' | 'critical' | 'neutral' | 'info';
const TONE_CLASS: Record<Tone, string> = { good: 'ok', warn: 'warn', critical: 'critical', neutral: 'neutral', info: 'neutral' };

/** A labelled status chip. The label is always shown; color is a secondary cue only. */
export function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`status ${TONE_CLASS[tone]}`} role="status">{label}</span>;
}

/** Data-trust tier badge (SYNTHETIC/UNVERIFIED/PLATFORM_REPORTED/VALIDATED/RECONCILED). */
export function TrustBadge({ tier, locale }: { tier: string; locale: Locale }) {
  const tone: Tone = tier === 'RECONCILED' || tier === 'VALIDATED' ? 'good' : tier === 'PLATFORM_REPORTED' ? 'neutral' : 'warn';
  return <StatusChip tone={tone} label={`${L(locale, 'Trust', 'الموثوقية')}: ${tier}`} />;
}

/** Confidence badge (LOW/MEDIUM/HIGH). */
export function ConfidenceBadge({ confidence, locale }: { confidence: string; locale: Locale }) {
  const tone: Tone = confidence === 'HIGH' ? 'good' : confidence === 'MEDIUM' ? 'neutral' : 'warn';
  return <StatusChip tone={tone} label={`${L(locale, 'Confidence', 'الثقة')}: ${confidence}`} />;
}

/** Risk badge (LOW/MODERATE/HIGH). Higher risk is a stronger warning, never a success color. */
export function RiskBadge({ risk, locale }: { risk: string; locale: Locale }) {
  const tone: Tone = risk === 'HIGH' ? 'critical' : risk === 'MODERATE' ? 'warn' : 'neutral';
  return <StatusChip tone={tone} label={`${L(locale, 'Risk', 'المخاطرة')}: ${risk}`} />;
}

/** Freshness badge from a data age in days. */
export function FreshnessBadge({ ageDays, locale }: { ageDays: number; locale: Locale }) {
  const tone: Tone = ageDays <= 1 ? 'good' : ageDays < 3 ? 'neutral' : 'warn';
  const label = ageDays <= 0 ? L(locale, 'fresh today', 'محدّث اليوم') : `${ageDays}${L(locale, 'd old', ' يوم')}`;
  return <StatusChip tone={tone} label={`${L(locale, 'Data', 'البيانات')}: ${label}`} />;
}

/** A single headline metric with an optional footnote. */
export function MetricCard({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return <div className="metric-card"><div className="cell-sub">{label}</div><div className="metric-value">{value}</div>{foot && <div className="cell-sub">{foot}</div>}</div>;
}

/** An evidence block — the raw values/calculation behind a claim (never model prose). */
export function EvidenceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="evidence-card"><div className="cell-sub"><strong>{title}</strong></div><div className="cell-sub">{children}</div></div>;
}

/** An insight (a read observation) and a recommendation (a review-only proposed action). */
export function InsightCard({ title, body, badges }: { title: string; body: string; badges?: React.ReactNode }) {
  return <div className="insight-card"><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{title}</strong><span>{badges}</span></div><p className="cell-sub">{body}</p></div>;
}
export function RecommendationCard({ title, body, badges, locale }: { title: string; body: string; badges?: React.ReactNode; locale: Locale }) {
  return <div className="insight-card"><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{title}</strong><span>{badges}</span></div><p className="cell-sub">{body}</p><p className="cell-sub">{L(locale, 'Review-only — nothing is applied without explicit human approval.', 'للمراجعة فقط — لا يُطبّق شيء دون موافقة بشرية صريحة.')}</p></div>;
}

/** A blocked/withheld state — distinct from empty: the data exists but is deliberately not shown. */
export function BlockedState({ title, reason }: { title: string; reason: string }) {
  return <div className="blocked-state" role="note"><strong>{title}</strong><p className="cell-sub">{reason}</p></div>;
}

/** A canonical link to an entity (campaign/creative/account), so entity navigation is consistent. */
export function EntityLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} prefetch={false} className="entity-link">{label}</Link>;
}

/** A simple accessible table with a caption. */
export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A titled container for a chart (pairs with components/charts.tsx). */
export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="chart-card"><div className="card-head"><h3>{title}</h3></div>{children}</section>;
}

/** A vertical timeline (decisions/outcomes/memory). */
export function Timeline({ items }: { items: Array<{ when: string; label: string; detail?: string; tone?: Tone }> }) {
  return <ol className="timeline">{items.map((it, i) => <li key={i} className="timeline-item"><span className="cell-sub">{it.when}</span> {it.tone && <StatusChip tone={it.tone} label={it.label} />}{!it.tone && <strong>{it.label}</strong>}{it.detail && <div className="cell-sub">{it.detail}</div>}</li>)}</ol>;
}

/** A single-row filter bar container (filters above the content, per the dataviz interaction rule). */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="filter-bar" role="group">{children}</div>;
}
