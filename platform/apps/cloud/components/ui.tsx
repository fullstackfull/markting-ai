import Link from 'next/link';
import { ProviderLogo, providerLabel } from '@/components/logos';
import { intlTag, type Locale } from '@/lib/i18n/config';

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="subhead">{description}</p>
      </div>
      {action ? <div className="page-head-actions">{action}</div> : null}
    </div>
  );
}

export function Metric({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{foot}</div>
    </div>
  );
}

export function Empty({ title, copy, href, action }: { title: string; copy: string; href?: string; action?: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{copy}</p>
      {href && action ? <Link className="button" href={href}>{action}</Link> : null}
    </div>
  );
}

export function Provider({ name }: { name: string }) {
  return (
    <span className="provider">
      <span className="provider-logo"><ProviderLogo name={name} /></span>
      {providerLabel(name)}
    </span>
  );
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = status === 'connected' ? '' : status === 'error' ? 'critical' : status === 'revoked' ? 'neutral' : 'warn';
  return <span className={`status ${tone}`}>{label ?? status}</span>;
}

export function AuthFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-bar">
          <div className="traffic" aria-hidden="true"><i /><i /><i /></div>
          <span>adport.dev — {label}</span>
        </div>
        <div className="auth-body">{children}</div>
      </section>
    </main>
  );
}

// Formatters take the UI locale; Arabic keeps Latin digits (see intlTag) so metrics stay comparable.
export function formatNumber(value = 0, locale: Locale = 'en'): string { return new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: 1 }).format(value); }
export function formatMoney(value = 0, currency = 'EUR', locale: Locale = 'en'): string {
  try { return new Intl.NumberFormat(intlTag(locale), { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${formatNumber(value, locale)} ${currency}`; }
}
export function formatDate(value: string | Date | null | undefined, locale: Locale = 'en'): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(intlTag(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
