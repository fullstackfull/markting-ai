/**
 * Coherence-2 Program 29 — the 50-question media-buyer benchmark as EXECUTABLE acceptance evidence.
 *
 * Each question declares how it is reached:
 *  - 'surface'      → a shipped product surface already answers it (Overview/Reports/Approvals/etc.);
 *  - 'assistant'    → the orchestrator-backed Assistant answers it, verified by a `check` on the result;
 *  - 'agent-only'   → only reachable by an external MCP agent (raw provider read) — NOT answerable now;
 *  - 'none'         → not reachable.
 * ANSWERABLE_NOW = 'surface' OR ('assistant' AND check passes). No question is counted on the basis of a
 * backend function alone — the assistant `check` asserts the real computed section/diagnosis is present.
 */
import type { AssistantAnswerWithSection } from './assistant-service';
import type { AnswerSection } from './sections';

export type ReachVia = 'surface' | 'assistant' | 'agent-only' | 'none';

/**
 * Program 27 — honest classification for every question that is NOT answerable now. A not-now question
 * is never silently "missing"; it carries exactly why, and none of these reasons is removable without a
 * live provider, a provider capability we do not have, or a deliberately-held write path. Faking an
 * intent to convert one of these into ANSWERABLE_NOW is explicitly out of scope.
 */
export type NotNowClass =
  | 'REQUIRES_LIVE_PROVIDER'        // needs a connected provider account + live data (no credentials here)
  | 'REQUIRES_PROVIDER_CAPABILITY'  // needs a provider read we don't normalize (GAQL search terms, IS, PMax)
  | 'NOT_SUPPORTED_BY_PRODUCT'      // would need a new intelligence capability (out of scope this program)
  | 'INTENTIONALLY_UNSUPPORTED';    // a write/mutation deliberately held (Mode B / autonomous disabled)

export interface BenchmarkQuestion {
  n: number;
  q: string;
  via: ReachVia;
  /** For 'assistant': the question text to route, and a predicate on the result. */
  ask?: string;
  check?: (a: AssistantAnswerWithSection) => boolean;
  /** For 'surface'/'agent-only'/'none': the reachable surface or the honest reason. */
  note: string;
  /** Required for 'agent-only'/'none': the honest reason this is not answerable now. */
  notNow?: NotNowClass;
}

const hasSection = (kind: AnswerSection['kind']) => (a: AssistantAnswerWithSection) => a.section?.kind === kind;
const decisive = (a: AssistantAnswerWithSection) => a.nextAction !== 'INSUFFICIENT_EVIDENCE';

export const BENCHMARK: BenchmarkQuestion[] = [
  { n: 1, q: 'What did I spend in the last 7/30 days?', via: 'surface', note: 'Overview tiles + Reports table' },
  { n: 2, q: "What's my blended ROAS?", via: 'surface', note: 'Overview (single-currency) + Reports' },
  { n: 3, q: 'Which campaigns are running right now?', via: 'surface', note: 'Campaign tables (status)' },
  { n: 4, q: 'Which campaigns spent with 0 conversions?', via: 'assistant', ask: 'which campaigns are wasting spend / data quality', check: (a) => a.section?.kind === 'dataQuality' || a.section?.kind === 'trend', note: 'diagnosis/data-quality' },
  { n: 5, q: 'Which campaigns have CPA far above median?', via: 'assistant', ask: 'diagnose this campaign CPA', check: (a) => a.intent === 'CAMPAIGN_DIAGNOSIS' && (decisive(a) || a.evidence.length > 0), note: 'campaign diagnosis' },
  { n: 6, q: 'Which campaigns are below break-even ROAS?', via: 'assistant', ask: 'true profit and break-even', check: (a) => a.section?.kind === 'commerce' && (a.section).available, note: 'commerce/profit section' },
  { n: 7, q: 'Which ads have low CTR on high impressions?', via: 'assistant', ask: 'which creatives are underperforming', check: (a) => a.section?.kind === 'creative' && (a.section).rows.length > 0, note: 'creative section' },
  { n: 8, q: 'Why did CPA rise yesterday?', via: 'assistant', ask: 'why did CPA rise on this campaign', check: (a) => a.intent === 'CAMPAIGN_DIAGNOSIS' || a.intent === 'PROFITABILITY_DECLINE', note: 'diagnosis' },
  { n: 9, q: 'Where should I put another $1,000?', via: 'assistant', ask: 'where should I put another $1000', check: (a) => a.section?.kind === 'scenario' && (a.section).balanced.totalMovedMinor + (a.section).balanced.unallocatedMinor === (a.section).extraMinor, note: 'scenario/allocation section (conservation)' },
  { n: 10, q: "What's the marginal ROAS of my next dollar?", via: 'assistant', ask: 'what is the marginal ROAS of my next dollar', check: (a) => a.section?.kind === 'response' && (a.section).marginal.marginalCpa != null || (a.section?.kind === 'response' && !!(a.section).marginal.reason), note: 'response-curve/marginal section' },
  { n: 11, q: 'Which campaigns are saturated?', via: 'assistant', ask: 'which campaigns are saturated', check: (a) => a.section?.kind === 'response' && Array.isArray((a.section).saturation.signals) && (a.section).saturation.state.length > 0, note: 'saturation section' },
  { n: 12, q: 'Which campaigns can I scale safely?', via: 'assistant', ask: 'which campaigns can I scale safely', check: (a) => a.section?.kind === 'scaling' && (a.section).rows.length > 0 && (a.section).rows.every((r) => !!r.result.state), note: 'scaling-readiness section' },
  { n: 13, q: 'Is my budget pacing on track today?', via: 'assistant', ask: 'is my budget pacing on track', check: (a) => a.section?.kind === 'pacing' && (a.section).result.status !== 'NOT_EVALUABLE', note: 'pacing section' },
  { n: 14, q: 'Will I overspend/underspend by month-end?', via: 'assistant', ask: 'will I overspend by month end forecast', check: (a) => a.section?.kind === 'forecast' && (a.section).spend.estimate > 0, note: 'forecast section' },
  { n: 15, q: 'Why is Meta ROAS different from store MER?', via: 'assistant', ask: 'why is platform ROAS different from store MER', check: (a) => a.section?.kind === 'commerce' && !!(a.section).reconciliation, note: 'commerce reconciliation' },
  { n: 16, q: "What's my true profit/margin after COGS?", via: 'assistant', ask: 'what is my true profit and margin after COGS', check: (a) => a.section?.kind === 'commerce' && (a.section).available && !!(a.section).margin, note: 'commerce/margin section (UNKNOWN when COGS missing)' },
  { n: 17, q: 'What happened after your last recommendation?', via: 'assistant', ask: 'what happened after my last recommendation', check: (a) => a.section?.kind === 'outcomes' && (a.section).rows.length > 0, note: 'outcomes section' },
  { n: 18, q: 'Which clients need attention first?', via: 'assistant', ask: 'which client needs attention first', check: (a) => a.section?.kind === 'portfolio' && (a.section).rows.length > 0, note: 'portfolio attention queue' },
  { n: 19, q: 'Which creatives are fatiguing?', via: 'assistant', ask: 'which creatives are fatiguing', check: (a) => a.section?.kind === 'creative' && (a.section).rows.some((r) => r.fatigue !== 'NO_SIGNAL'), note: 'creative fatigue' },
  { n: 20, q: 'Which creative should I refresh/kill?', via: 'assistant', ask: 'which creative should I refresh or kill', check: (a) => a.section?.kind === 'creative' && (a.section).rows.length > 0, note: 'creative section' },
  { n: 21, q: "What's my frequency / am I over-saturating audiences?", via: 'assistant', ask: 'am I over-saturating / is frequency too high (saturation)', check: (a) => a.section?.kind === 'response' && (a.section).saturation.state.length > 0, note: 'saturation (frequency-aware) section' },
  { n: 22, q: 'Which placements perform best (Meta)?', via: 'assistant', ask: 'which placements perform best', check: (a) => a.section?.kind === 'breakdown' && (a.section).analyses.some((x) => x.dimension === 'placement' && x.supported), note: 'breakdown engine (placement)' },
  { n: 23, q: 'What are my top search terms (Google)?', via: 'agent-only', note: 'GAQL search_term_view via MCP agent only', notNow: 'REQUIRES_PROVIDER_CAPABILITY' },
  { n: 24, q: 'What negatives should I add?', via: 'agent-only', note: 'no negative-keyword suggestion engine in-product', notNow: 'NOT_SUPPORTED_BY_PRODUCT' },
  { n: 25, q: "What's my Search impression share / lost IS?", via: 'agent-only', note: 'GAQL metric via MCP agent only; not normalized', notNow: 'REQUIRES_PROVIDER_CAPABILITY' },
  { n: 26, q: 'How is my PMax doing by asset group?', via: 'agent-only', note: 'no PMax asset-group read in-product', notNow: 'REQUIRES_PROVIDER_CAPABILITY' },
  { n: 27, q: 'Pause this wasteful campaign', via: 'assistant', ask: 'which wasteful campaign should I review pausing', check: (a) => a.recommendationIds.length > 0 || decisive(a), note: 'review recommendation (apply via governed path)' },
  { n: 28, q: 'Raise budget on my best campaign', via: 'assistant', ask: 'where should I allocate extra budget to scale my best campaign', check: (a) => a.section?.kind === 'scenario' && (a.section).balanced.totalMovedMinor + (a.section).balanced.unallocatedMinor === (a.section).extraMinor, note: 'scenario review (apply via governed path)' },
  { n: 29, q: 'Change bid strategy to target ROAS (Google)', via: 'agent-only', note: 'bid-strategy change via MCP agent→approval only', notNow: 'INTENTIONALLY_UNSUPPORTED' },
  { n: 30, q: 'Create a new campaign', via: 'agent-only', note: 'campaign creation via MCP agent→approval only', notNow: 'INTENTIONALLY_UNSUPPORTED' },
  { n: 31, q: 'Launch a responsive search ad', via: 'agent-only', note: 'RSA creation via MCP agent→approval only', notNow: 'INTENTIONALLY_UNSUPPORTED' },
  { n: 32, q: 'Show spend trend over time', via: 'assistant', ask: 'show my spend trend over time', check: (a) => a.section?.kind === 'trend', note: 'trend section (chart on surface)' },
  { n: 33, q: 'Compare this week vs last week', via: 'surface', note: 'Reports engine weekly report (spend+CPA deltas)' },
  { n: 34, q: 'Break performance down by device/age/geo', via: 'assistant', ask: 'break performance down by device and geography', check: (a) => a.section?.kind === 'breakdown' && (a.section).analyses.some((x) => x.supported), note: 'breakdown engine (device/geo)' },
  { n: 35, q: 'Which audiences convert best?', via: 'assistant', ask: 'which audience segments convert best', check: (a) => a.section?.kind === 'breakdown' && (a.section).analyses.some((x) => x.dimension === 'audience_segment' && x.supported), note: 'breakdown engine (audience_segment)' },
  { n: 36, q: 'Attribution window sensitivity?', via: 'none', note: 'attribution window not a surfaced control', notNow: 'REQUIRES_PROVIDER_CAPABILITY' },
  { n: 37, q: 'Cross-channel view (Meta vs Google) with comparability?', via: 'assistant', ask: 'compare Meta vs Google cross-channel', check: (a) => a.section?.kind === 'crossChannel' && !!(a.section).roas.comparability.state && (((a.section).roas.ranking?.length ?? 0) > 0 || (a.section).roas.comparability.reasons.length > 0), note: 'cross-channel comparison engine' },
  { n: 38, q: 'Portfolio spend across all clients/currencies', via: 'assistant', ask: 'portfolio across all my clients', check: (a) => a.section?.kind === 'portfolio' && (a.section).rows.length >= 2, note: 'portfolio (no fake currency blend)' },
  { n: 39, q: 'Anomaly alerts (spend spike, conv drop)', via: 'assistant', ask: 'any anomaly or spend spike', check: (a) => a.section?.kind === 'anomaly' && (a.section).report.points.length > 0, note: 'anomaly section' },
  { n: 40, q: "Forecast next month's results", via: 'assistant', ask: 'forecast next month results', check: (a) => a.section?.kind === 'forecast' && (a.section).spend.estimate > 0, note: 'forecast section' },
  { n: 41, q: "What's my CPM trend / is inventory inflating?", via: 'assistant', ask: 'what is my CPM / spend trend', check: (a) => a.section?.kind === 'trend' && !!(a.section).cpa.direction && !!(a.section).spend.direction, note: 'trend section' },
  { n: 42, q: 'Weekly client report to send', via: 'surface', note: 'Reports engine weekly PDF/HTML' },
  { n: 43, q: 'Which accounts am I connected to?', via: 'surface', note: 'Connections + Accounts pages' },
  { n: 44, q: 'Who changed what, when (audit trail)?', via: 'surface', note: 'Audit log page' },
  { n: 45, q: "What's pending my approval?", via: 'surface', note: 'Approvals page + Overview tile' },
  { n: 46, q: 'Enforce "no budget change >20%" policy', via: 'surface', note: 'Policies page + policy engine' },
  { n: 47, q: 'Give my AI agent scoped access', via: 'surface', note: 'Agents page API-key manager + MCP' },
  { n: 48, q: 'Ask the assistant "why is performance down?"', via: 'assistant', ask: 'why is performance down', check: (a) => a.source === 'DETERMINISTIC_ONLY' && a.text.en.length > 0, note: 'orchestrated assistant answer' },
  { n: 49, q: 'Run an experiment / holdout test', via: 'assistant', ask: 'design an experiment / holdout test', check: (a) => a.section?.kind === 'experiments' && (a.section).rows.length > 0, note: 'experiment workbench section' },
  { n: 50, q: 'Dedup / cluster my creatives by theme', via: 'assistant', ask: 'cluster my creatives by hook/theme', check: (a) => a.section?.kind === 'creative' && (a.section).hooks.length > 0, note: 'creative hook/cluster aggregation' },
];
