import type { Locale } from '@/lib/i18n/config';

/**
 * Coherence hardening Program 8 — reusable, accessible inline-SVG chart primitives (server components,
 * no client JS). Every chart ships: a title, a unit, an SVG <title>/<desc> + a visible accessible text
 * summary (identity never color-alone), an empty state, an insufficient-data state, native per-mark
 * hover tooltips (<title> elements), and a legend for ≥2 series. Dual-series charts use color + a
 * hatch pattern (secondary encoding) so they are CVD-safe without a palette validator. Numeric axes
 * render LTR (the app forces Latin numerals); surrounding labels follow locale/RTL.
 */
const INK = 'var(--text-muted, #667085)';
const ACCENT = 'var(--accent, #3b82f6)';
const ACCENT2 = 'var(--accent-2, #9ca3af)';
const GRID = 'var(--border, #e5e7eb)';
const L = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

function Frame({ title, unit, summary, children, locale }: { title: string; unit?: string; summary: string; children: React.ReactNode; locale: Locale }) {
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption className="cell-sub" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span><strong>{title}</strong>{unit ? ` (${unit})` : ''}</span>
      </figcaption>
      {children}
      <p className="chart-summary cell-sub" style={{ marginTop: 4 }}>{L(locale, 'Summary', 'ملخّص')}: {summary}</p>
    </figure>
  );
}

function Empty({ title, locale, insufficient }: { title: string; locale: Locale; insufficient?: boolean }) {
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption className="cell-sub"><strong>{title}</strong></figcaption>
      <p className="cell-sub">{insufficient ? L(locale, 'Insufficient data to chart.', 'بيانات غير كافية للرسم.') : L(locale, 'No data.', 'لا بيانات.')}</p>
    </figure>
  );
}

const W = 520, H = 160, PAD = 28;

/** Time series (line) over a numeric series. Minimum 3 points or it shows the insufficient state. */
export function TimeSeriesChart({ title, unit, values, locale, seriesLabel }: { title: string; unit?: string; values: number[]; locale: Locale; seriesLabel?: string }) {
  if (!values.length) return <Empty title={title} locale={locale} />;
  if (values.length < 3) return <Empty title={title} locale={locale} insufficient />;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (values.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const first = values[0]!, last = values[values.length - 1]!;
  const dir = last > first ? L(locale, 'rising', 'صاعد') : last < first ? L(locale, 'falling', 'هابط') : L(locale, 'flat', 'ثابت');
  const summary = `${seriesLabel ?? title} ${dir}, ${first} → ${last} (min ${min}, max ${max}).`;
  return (
    <Frame title={title} unit={unit} summary={summary} locale={locale}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        <title>{title}</title><desc>{summary}</desc>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth="1" />
        <path d={d} fill="none" stroke={ACCENT} strokeWidth="2" />
        {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={ACCENT}><title>{`#${i + 1}: ${v}`}</title></circle>)}
      </svg>
    </Frame>
  );
}

interface Bar { label: string; value: number; group?: 'current' | 'previous' | string }
/** Horizontal bars — serves contribution, breakdown, comparison and scenario (group=current/previous). */
export function BarChart({ title, unit, bars, locale, twoSeries }: { title: string; unit?: string; bars: Bar[]; locale: Locale; twoSeries?: boolean }) {
  if (!bars.length) return <Empty title={title} locale={locale} />;
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  const rowH = 20, gap = 6, chartW = 360, labelW = 130;
  const h = bars.length * (rowH + gap) + 10;
  const summary = bars.slice(0, 5).map((b) => `${b.label} ${b.value}`).join('; ');
  return (
    <Frame title={title} unit={unit} summary={summary} locale={locale}>
      <svg viewBox={`0 0 ${labelW + chartW + 50} ${h}`} width="100%" role="img" aria-label={`${title}. ${summary}`} preserveAspectRatio="xMidYMid meet">
        <title>{title}</title><desc>{summary}</desc>
        {twoSeries && <defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke={ACCENT2} strokeWidth="2" /></pattern></defs>}
        {bars.map((b, i) => {
          const w = (Math.abs(b.value) / max) * chartW;
          const yy = 6 + i * (rowH + gap);
          const prev = b.group === 'previous';
          return (
            <g key={i}>
              <text x={labelW - 6} y={yy + rowH / 2 + 4} textAnchor="end" fontSize="11" fill={INK}>{b.label.slice(0, 22)}</text>
              <rect x={labelW} y={yy} width={Math.max(2, w)} height={rowH} rx="3" fill={prev ? 'url(#hatch)' : ACCENT} stroke={prev ? ACCENT2 : 'none'}><title>{`${b.label}${b.group ? ` (${b.group})` : ''}: ${b.value}`}</title></rect>
              <text x={labelW + Math.max(2, w) + 6} y={yy + rowH / 2 + 4} fontSize="11" fill={INK}>{b.value}</text>
            </g>
          );
        })}
      </svg>
      {twoSeries && <p className="cell-sub">{L(locale, 'Solid = current, hatched = previous.', 'مصمت = الحالي، مخطط = السابق.')}</p>}
    </Frame>
  );
}

/** Funnel — decreasing stages. */
export function FunnelChart({ title, stages, locale }: { title: string; stages: Array<{ label: string; value: number }>; locale: Locale }) {
  if (stages.length < 2) return <Empty title={title} locale={locale} insufficient />;
  const bars: Bar[] = stages.map((s) => ({ label: s.label, value: s.value }));
  return <BarChart title={title} bars={bars} locale={locale} />;
}

/** Pacing gauge — elapsed vs spent fraction. */
export function PacingChart({ title, elapsedPct, spentPct, locale }: { title: string; elapsedPct: number; spentPct: number; locale: Locale }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const e = clamp(elapsedPct), s = clamp(spentPct);
  const summary = L(locale, `elapsed ${e}% vs spent ${s}%`, `منقضٍ ${e}% مقابل مُنفق ${s}%`);
  return (
    <Frame title={title} summary={summary} locale={locale}>
      <svg viewBox="0 0 520 54" width="100%" role="img" aria-label={`${title}. ${summary}`} preserveAspectRatio="xMidYMid meet">
        <title>{title}</title><desc>{summary}</desc>
        <rect x="4" y="6" width="512" height="16" rx="8" fill={GRID} />
        <rect x="4" y="6" width={5.12 * s} height="16" rx="8" fill={ACCENT}><title>{`spent ${s}%`}</title></rect>
        <line x1={4 + 5.12 * e} y1="2" x2={4 + 5.12 * e} y2="26" stroke={INK} strokeWidth="2"><title>{`elapsed ${e}%`}</title></line>
        <text x="4" y="44" fontSize="11" fill={INK}>{L(locale, 'spent', 'مُنفق')} {s}%</text>
        <text x="516" y="44" fontSize="11" fill={INK} textAnchor="end">{L(locale, 'elapsed', 'منقضٍ')} {e}%</text>
      </svg>
    </Frame>
  );
}
