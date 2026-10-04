import 'server-only';
import type { ReportRow } from '@adport/core';
import { isKnownCurrency } from '@adport/core';
import type { IntelligenceGatherer, GatheredIntelligence } from '@/lib/markting/orchestrator/assistant-service';
import { normalizeReportRows } from '@/lib/markting/intelligence/normalize';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { loadBusinessContext } from '@/lib/markting/business-context';
import { readReportRows } from './reads';
import { resolveRange, type RangeSelection, type ResolvedRange } from './date-range';
import type { TenantPrincipal } from './types';

/**
 * PHASE A (A4 + A5) — the LIVE value loop gatherer.
 *
 * provider adapter → ReportRow → validate → normalize → canonical MetricObservation → analyzeAccount
 * (the real deterministic engine) → orchestrator slices. NO parallel pipeline (it reuses
 * normalizeReportRows + analyzeAccount + the orchestrator), NO hard-coded diagnosis, NO fixture branch.
 * Observations carry PLATFORM_REPORTED trust so the source-isolation guard keeps the surface live-safe;
 * when nothing is connected it degrades to the honest NOT_CONNECTED empty state (never demo content).
 */

export interface RejectedRow { provider: string; entityId: string; reason: string }

/** Deterministic row validation — classify/reject rather than silently coerce (A4). */
export function validateReportRow(row: ReportRow): { ok: true } | { ok: false; reason: string } {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'malformed row' };
  if (!row.accountId) return { ok: false, reason: 'missing account identity' };
  if (!row.entity || !row.entity.id) return { ok: false, reason: 'missing entity identity' };
  if (row.currency && !isKnownCurrency(row.currency)) return { ok: false, reason: `unsupported currency ${row.currency}` };
  const NON_NEGATIVE = new Set(['spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'cpa', 'cpc', 'cpm', 'roas']);
  for (const [k, v] of Object.entries(row.metrics ?? {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `non-finite metric ${k}` };
    if (NON_NEGATIVE.has(k) && v < 0) return { ok: false, reason: `impossible negative ${k}` };
  }
  return { ok: true };
}

function partition(rows: ReportRow[]): { valid: ReportRow[]; rejected: RejectedRow[] } {
  const valid: ReportRow[] = [];
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const v = validateReportRow(row);
    if (v.ok) valid.push(row);
    else rejected.push({ provider: row?.provider ?? 'unknown', entityId: row?.entity?.id ?? 'unknown', reason: v.reason });
  }
  return { valid, rejected };
}

export interface LiveGatherResult {
  gathered: GatheredIntelligence;
  range: ResolvedRange;
  connected: boolean;
  rowsCurrent: number;
  rejected: RejectedRow[];
  readAt: string;
  /** Explicit provenance for the live loop (A4 source honesty). */
  provenance: 'LIVE';
  warnings: Array<{ provider: string; message: string }>;
}

const EMPTY_AVAILABILITY = {
  MEDIA: 'NOT_CONNECTED', COMMERCE: 'NOT_CONNECTED', CREATIVE: 'NOT_CONNECTED',
  HISTORY: 'NO_SIGNAL', MEMORY: 'NO_SIGNAL', EXPERIMENTS: 'NOT_CONNECTED',
} as const;

/**
 * Run the live loop once and return both the orchestrator slices and the surface metadata (range,
 * freshness, provenance, rejected rows). Pure read-through — no persistence, no writes.
 */
export async function gatherLive(
  principal: TenantPrincipal,
  selection: RangeSelection,
): Promise<LiveGatherResult> {
  const business = await loadBusinessContext(principal.organizationId);
  const timezone = business.timezone.value ?? undefined;
  const range = resolveRange(selection, timezone);
  const readAt = new Date().toISOString();
  // Deterministic completeness from the resolver (a window ending today is partial), not a preset guess.
  const windowComplete = range.windowComplete;

  const [curAcc, prevAcc, curCamp, prevCamp] = await Promise.all([
    readReportRows(principal, { level: 'account', dateRange: range.current }),
    readReportRows(principal, { level: 'account', dateRange: range.previous }),
    readReportRows(principal, { level: 'campaign', dateRange: range.current }),
    readReportRows(principal, { level: 'campaign', dateRange: range.previous }),
  ]);

  const connected = curCamp.connected;
  const warnings = [...curAcc.warnings, ...curCamp.warnings];
  const curCampRows = curCamp.ok ? curCamp.data.rows : [];
  if (!connected || curCampRows.length === 0) {
    // Honest empty state — never demo content, trust stays neutral (UNVERIFIED) so the live posture guard passes.
    return { gathered: { availability: { ...EMPTY_AVAILABILITY } }, range, connected, rowsCurrent: 0, rejected: [], readAt, provenance: 'LIVE', warnings };
  }

  const pc = partition(curCampRows);
  const pp = partition(prevCamp.ok ? prevCamp.data.rows : []);
  const pa = partition(curAcc.ok ? curAcc.data.rows : []);
  const ppa = partition(prevAcc.ok ? prevAcc.data.rows : []);
  const rejected = [...pc.rejected, ...pp.rejected, ...pa.rejected, ...ppa.rejected];

  const mk = (rows: ReportRow[], dateRange: { start: string; end: string }) =>
    normalizeReportRows(rows, { tier: 'PLATFORM_REPORTED', dateRange, windowComplete, timezone, readAt });

  const currentCampaigns = mk(pc.valid, range.current);
  const previousCampaigns = mk(pp.valid, range.previous);
  // Account-level: use the account rows if the provider returned them, else fall back to the campaign rows
  // (analyzeAccount aggregates them) so a provider that only reports at campaign level still gets a diagnosis.
  const currentAccount = pa.valid.length ? mk(pa.valid, range.current) : currentCampaigns;
  const previousAccount = ppa.valid.length ? mk(ppa.valid, range.previous) : previousCampaigns;

  const intel = analyzeAccount({
    engineContext: { organizationId: principal.organizationId, timezone: timezone ?? 'UTC', locale: 'en' },
    dataset: 'LIVE',
    period: { current: range.current, previous: range.previous },
    currentAccount, previousAccount, currentCampaigns, previousCampaigns,
    business,
  });

  const diagnoses = [...intel.accountDiagnoses, ...intel.campaigns.flatMap((c) => c.diagnoses)];
  const gathered: GatheredIntelligence = {
    media: { diagnoses, recommendations: intel.recommendations },
    availability: {
      COMMERCE: 'NOT_CONNECTED', CREATIVE: 'NOT_CONNECTED',
      HISTORY: 'NO_SIGNAL', MEMORY: 'NO_SIGNAL', EXPERIMENTS: 'NOT_CONNECTED',
    },
  };
  return { gathered, range, connected, rowsCurrent: pc.valid.length, rejected, readAt, provenance: 'LIVE', warnings };
}

/** The live gatherer bound to a principal + selected range, for the orchestrator service. */
export function createLiveGatherer(principal: TenantPrincipal, selection: RangeSelection): IntelligenceGatherer {
  return {
    async gather() {
      const { gathered } = await gatherLive(principal, selection);
      return gathered;
    },
  };
}
