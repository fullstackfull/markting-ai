/**
 * Phase 4V/4W/4X/4Y/4Z — creative product surfaces: Library, Dashboard, Ask, and the Morning-Brief
 * addendum. All are deterministic selectors over a bounded set of creative-intelligence rows. Sample
 * sizes are always shown; global averages are NOT computed across incompatible cohorts; the brief is
 * materiality-prioritized, not flooded. Pure.
 */
import type { BiText } from '../intelligence/decision-model';
import type { CreativeRating, CreativeLifecycle } from './performance';
import type { FatigueState } from './fatigue';
import type { HookType, AngleType } from './classify';

export interface CreativeIntelRow {
  creativeId: string;
  name: string;
  provider: string;
  accountId: string;
  campaignId?: string;
  mediaType: string;
  status?: string;
  rating: CreativeRating;
  fatigue: FatigueState;
  lifecycle: CreativeLifecycle;
  primaryHook: HookType;
  topAngle?: AngleType;
  clusterId?: string;
  spend: number;
  conversions: number;
  currency?: string;
}

export interface CreativeLibrary {
  all: CreativeIntelRow[];
  newCreatives: CreativeIntelRow[];
  topPerformers: CreativeIntelRow[];
  watch: CreativeIntelRow[];
  fatigueSignals: CreativeIntelRow[];
  underperformers: CreativeIntelRow[];
  byHook: Record<string, CreativeIntelRow[]>;
  byAngle: Record<string, CreativeIntelRow[]>;
  byFormat: Record<string, CreativeIntelRow[]>;
  byCluster: Record<string, CreativeIntelRow[]>;
}

export interface CreativeFilters { provider?: string; accountId?: string; campaignId?: string; mediaType?: string; status?: string; hook?: HookType; angle?: AngleType; performanceState?: CreativeRating }

export function buildCreativeLibrary(rows: CreativeIntelRow[], filters: CreativeFilters = {}): CreativeLibrary {
  const all = rows.filter((r) =>
    (!filters.provider || r.provider === filters.provider) &&
    (!filters.accountId || r.accountId === filters.accountId) &&
    (!filters.campaignId || r.campaignId === filters.campaignId) &&
    (!filters.mediaType || r.mediaType === filters.mediaType) &&
    (!filters.status || r.status === filters.status) &&
    (!filters.hook || r.primaryHook === filters.hook) &&
    (!filters.angle || r.topAngle === filters.angle) &&
    (!filters.performanceState || r.rating === filters.performanceState));
  const group = <K extends keyof CreativeIntelRow>(key: K) => all.reduce<Record<string, CreativeIntelRow[]>>((acc, r) => { const k = String(r[key] ?? 'UNKNOWN'); (acc[k] ??= []).push(r); return acc; }, {});
  return {
    all,
    newCreatives: all.filter((r) => r.lifecycle === 'NEW' || r.lifecycle === 'LEARNING'),
    topPerformers: all.filter((r) => r.rating === 'STRONG_PERFORMER' || r.rating === 'PROMISING'),
    watch: all.filter((r) => r.fatigue === 'WATCH'),
    fatigueSignals: all.filter((r) => r.fatigue === 'FATIGUE_SIGNAL' || r.fatigue === 'STRONG_FATIGUE_SIGNAL'),
    underperformers: all.filter((r) => r.rating === 'UNDERPERFORMING'),
    byHook: group('primaryHook'), byAngle: group('topAngle'), byFormat: group('mediaType'), byCluster: group('clusterId'),
  };
}

export interface DashboardSection { label: string; count: number; sampleSize: number }
export interface CreativeDashboard {
  overview: DashboardSection[];
  byHook: DashboardSection[];
  byAngle: DashboardSection[];
  byFormat: DashboardSection[];
  caveat: string;
}

function section(label: string, rows: CreativeIntelRow[]): DashboardSection {
  return { label, count: rows.length, sampleSize: rows.reduce((a, r) => a + r.conversions, 0) };
}
function groupSections(rows: CreativeIntelRow[], key: keyof CreativeIntelRow): DashboardSection[] {
  const m = new Map<string, CreativeIntelRow[]>();
  for (const r of rows) {
    const k = String(r[key] ?? 'UNKNOWN');
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return [...m.entries()].map(([k, rs]) => section(k, rs));
}

export function buildCreativeDashboard(rows: CreativeIntelRow[]): CreativeDashboard {
  return {
    overview: [
      section('all', rows),
      section('promising+strong', rows.filter((r) => r.rating === 'STRONG_PERFORMER' || r.rating === 'PROMISING')),
      section('fatigue_watch', rows.filter((r) => r.fatigue === 'WATCH' || r.fatigue === 'FATIGUE_SIGNAL' || r.fatigue === 'STRONG_FATIGUE_SIGNAL')),
      section('underperformers', rows.filter((r) => r.rating === 'UNDERPERFORMING')),
      section('new', rows.filter((r) => r.lifecycle === 'NEW' || r.lifecycle === 'LEARNING')),
    ],
    byHook: groupSections(rows, 'primaryHook'),
    byAngle: groupSections(rows, 'topAngle'),
    byFormat: groupSections(rows, 'mediaType'),
    caveat: 'Counts carry sample size (conversions). Hook/angle/format breakdowns are not comparable across different currencies/objectives/audiences — do not read them as a single global average.',
  };
}

// ---- Ask (4Y) + Brief (4Z) ----
export type CreativeIntent = 'WHICH_TIRING' | 'BEST_HOOKS' | 'WHY_DETERIORATED' | 'CARRYING_CAMPAIGN' | 'WHAT_TO_TEST' | 'VIDEO_VS_IMAGE' | 'REVIEW_FIRST' | 'UNKNOWN';
const PATTERNS: Array<{ intent: CreativeIntent; re: RegExp }> = [
  { intent: 'WHICH_TIRING', re: /tir(ing|ed)|fatigue|يُجهَد|إجهاد|متعب/i },
  { intent: 'BEST_HOOKS', re: /best hooks?|which hooks?|أفضل.*(مقدمات|hook)|أي مقدمة/i },
  { intent: 'WHY_DETERIORATED', re: /why.*(deteriorat|declin|drop|worse)|لماذا.*(تراجع|انخفض|ساء)/i },
  { intent: 'CARRYING_CAMPAIGN', re: /carrying|driving (this|the) campaign|يحمل|يقود (هذه )?الحملة/i },
  { intent: 'WHAT_TO_TEST', re: /what.*test|test next|ماذا.*(نختبر|اختبار)/i },
  { intent: 'VIDEO_VS_IMAGE', re: /videos?.*(vs|better|outperform).*images?|فيديو.*(مقابل|أفضل).*صور/i },
  { intent: 'REVIEW_FIRST', re: /review first|أراجع أولًا|أبدأ بمراجعة/i },
];
export function classifyCreativeQuestion(q: string): CreativeIntent {
  for (const p of PATTERNS) if (p.re.test(q)) return p.intent;
  return 'UNKNOWN';
}

export interface CreativeAnswer { intent: CreativeIntent; text: string; cited: string[]; comparabilityCaveat: string }

export function answerCreativeQuestion(question: string, rows: CreativeIntelRow[], locale: 'en' | 'ar'): CreativeAnswer {
  const intent = classifyCreativeQuestion(question);
  const caveat = locale === 'ar' ? 'النتائج مشروطة بقابلية المقارنة (العملة/الهدف/الجمهور/الإسناد) وحجم العيّنة.' : 'Results are conditioned on comparability (currency/objective/audience/attribution) and sample size.';
  const cited: string[] = [];
  const insufficient = locale === 'ar' ? 'لا توجد أدلة كافية للإجابة بثقة بعد.' : 'Not enough evidence to answer confidently yet.';
  let text = insufficient;
  switch (intent) {
    case 'WHICH_TIRING': {
      const t = rows.filter((r) => r.fatigue === 'FATIGUE_SIGNAL' || r.fatigue === 'STRONG_FATIGUE_SIGNAL');
      cited.push(...t.map((r) => r.creativeId));
      text = t.length ? (locale === 'ar' ? `إشارات إجهاد (غير مثبتة) في: ${t.map((r) => r.name).join('، ')}.` : `Fatigue signals (not proven) in: ${t.map((r) => r.name).join(', ')}.`) : insufficient;
      break;
    }
    case 'CARRYING_CAMPAIGN': {
      const top = [...rows].sort((a, b) => b.conversions - a.conversions).slice(0, 3).filter((r) => r.conversions > 0);
      cited.push(...top.map((r) => r.creativeId));
      text = top.length ? (locale === 'ar' ? `أكثر الإعلانات مساهمة بالتحويلات: ${top.map((r) => `${r.name} (${r.conversions})`).join('، ')}.` : `Top conversion contributors: ${top.map((r) => `${r.name} (${r.conversions})`).join(', ')}.`) : insufficient;
      break;
    }
    case 'VIDEO_VS_IMAGE':
      text = locale === 'ar' ? 'مقارنة الفيديو بالصور صالحة فقط ضمن جمهور/هدف/إسناد قابل للمقارنة وبعيّنة كافية؛ وإلا فهي غير قابلة للمقارنة.' : 'A video-vs-image comparison is valid only within a comparable audience/objective/attribution and sufficient sample; otherwise NOT_COMPARABLE.';
      break;
    case 'REVIEW_FIRST': {
      const first = [...rows].filter((r) => r.fatigue === 'STRONG_FATIGUE_SIGNAL' || r.rating === 'UNDERPERFORMING').sort((a, b) => b.spend - a.spend)[0];
      cited.push(...(first ? [first.creativeId] : []));
      text = first ? (locale === 'ar' ? `ابدأ بمراجعة: ${first.name} (أعلى إنفاق مع إشارة/ضعف).` : `Review first: ${first.name} (highest spend with a signal/underperformance).`) : insufficient;
      break;
    }
    default:
      break;
  }
  return { intent, text, cited, comparabilityCaveat: caveat };
}

export interface CreativeBriefItem { text: BiText; priority: number }
/** Materiality-prioritized creative lines for the Morning Brief (do not flood). */
export function creativeBriefItems(rows: CreativeIntelRow[], max = 5): CreativeBriefItem[] {
  const items: CreativeBriefItem[] = [];
  for (const r of rows) {
    if (r.fatigue === 'STRONG_FATIGUE_SIGNAL') items.push({ priority: 90 + Math.min(9, r.spend / 1000), text: { en: `${r.name}: strong fatigue signal (not proven).`, ar: `${r.name}: إشارة إجهاد قوية (غير مثبتة).` } });
    else if (r.fatigue === 'FATIGUE_SIGNAL') items.push({ priority: 60 + Math.min(9, r.spend / 1000), text: { en: `${r.name}: fatigue signal (not proven).`, ar: `${r.name}: إشارة إجهاد (غير مثبتة).` } });
    if (r.rating === 'UNDERPERFORMING') items.push({ priority: 55 + Math.min(9, r.spend / 1000), text: { en: `${r.name}: underperforming vs comparable creatives.`, ar: `${r.name}: أداء ضعيف مقارنة بإعلانات مماثلة.` } });
    if (r.lifecycle === 'NEW') items.push({ priority: 20, text: { en: `${r.name}: newly launched — gathering data.`, ar: `${r.name}: أُطلق حديثًا — يجمع البيانات.` } });
  }
  return items.sort((a, b) => b.priority - a.priority).slice(0, max);
}
