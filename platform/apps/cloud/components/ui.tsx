import Link from 'next/link';
import { CURRENCY_EXPONENTS_UI as CURRENCY_EXPONENTS } from '@/lib/money-ui';
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

export const MIXED_CURRENCY = 'MIXED_CURRENCY';

/**
 * Whole-unit monetary amount + ISO currency → localized currency string. No forced fraction digits, so
 * Intl applies each currency's own exponent (USD 2, JPY 0, KWD 3). (Phase A / A2.)
 */
export function formatMoney(value = 0, currency = 'EUR', locale: Locale = 'en'): string {
  try { return new Intl.NumberFormat(intlTag(locale), { style: 'currency', currency }).format(value); }
  catch { return `${formatNumber(value, locale)} ${currency}`; }
}

/**
 * Integer MINOR-UNIT amount + currency → localized currency string (Phase A / A2). The canonical way to
 * render minor units in the UI — never show raw cents/fils. Honesty rules:
 *  - no/empty currency → render the raw number labeled "(currency unknown)", never guess a currency;
 *  - unknown-exponent currency → show the code without rescaling (avoid a wrong 100×/÷10 scale);
 *  - MIXED_CURRENCY sentinel → the caller already knows the amounts aren't comparable.
 */
export function formatMoneyMinor(minor: number | null | undefined, currency?: string | null, locale: Locale = 'en'): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  if (currency === MIXED_CURRENCY) return MIXED_CURRENCY;
  if (!currency) return `${formatNumber(minor, locale)} (currency unknown)`;
  const code = currency.trim().toUpperCase();
  const exponent = CURRENCY_EXPONENTS[code];
  if (exponent === undefined) return `${formatNumber(minor, locale)} ${code}`;
  const value = minor / 10 ** exponent;
  try { return new Intl.NumberFormat(intlTag(locale), { style: 'currency', currency: code }).format(value); }
  catch { return `${value} ${code}`; }
}
export function formatDate(value: string | Date | null | undefined, locale: Locale = 'en'): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(intlTag(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
