/**
 * Stage 24 — NO HIDDEN DEMO DATA. A production customer must never see fixture/demo values mixed with
 * live data. Every data record carries a source derived from its data-trust; this guard FAILS CLOSED:
 *  - a LIVE deployment must never surface FIXTURE or SANDBOX data;
 *  - a DEMO deployment must never surface LIVE data;
 *  - an UNKNOWN/ambiguous source is always refused;
 *  - a result set that MIXES live and non-live sources is refused.
 */
import type { DataTrust, DataTier } from '../data-trust';
import type { RuntimeMode } from '../runtime-mode';

export type DataSource = 'FIXTURE' | 'SANDBOX' | 'LIVE' | 'UNKNOWN';

const LIVE_TIERS: ReadonlyArray<DataTier> = ['PLATFORM_REPORTED', 'VALIDATED', 'RECONCILED'];

/** Classify a record's source from its data-trust (tier + source string). */
export function classifySource(trust: Pick<DataTrust, 'tier' | 'source'>): DataSource {
  if (trust.tier === 'SYNTHETIC') return /sandbox/i.test(trust.source) && !/fixture/i.test(trust.source) ? 'SANDBOX' : 'FIXTURE';
  if (LIVE_TIERS.includes(trust.tier)) {
    // A live tier whose source still looks synthetic is AMBIGUOUS → UNKNOWN (fail closed).
    if (/fixture|sandbox|synthetic|demo/i.test(trust.source)) return 'UNKNOWN';
    return 'LIVE';
  }
  if (trust.tier === 'UNVERIFIED') return /sandbox|fixture|demo/i.test(trust.source) ? 'SANDBOX' : 'UNKNOWN';
  return 'UNKNOWN';
}

/** Whether a deployment is a demo posture (serves only fixture/sandbox) vs a live customer posture. */
export function isDemoDeployment(mode: RuntimeMode): boolean {
  return mode === 'DEMO';
}

export type SourceVerdict = { ok: true } | { ok: false; reason: string };

/** A single record's source must match the deployment posture; UNKNOWN always fails closed. */
export function assertSourceAllowed(mode: RuntimeMode, source: DataSource): SourceVerdict {
  if (source === 'UNKNOWN') return { ok: false, reason: 'ambiguous data source — failing closed (never surfaced)' };
  if (isDemoDeployment(mode)) {
    return source === 'LIVE' ? { ok: false, reason: 'live data must not surface in a DEMO deployment' } : { ok: true };
  }
  // Live deployment: fixture/sandbox must never reach a live customer.
  return source === 'LIVE' ? { ok: true } : { ok: false, reason: `${source} data must not surface in a live (${mode}) deployment` };
}

/** A result set must not mix live with non-live sources, and every record must pass the posture check. */
export function assertNoMixedSources(mode: RuntimeMode, records: Array<Pick<DataTrust, 'tier' | 'source'>>): SourceVerdict {
  const sources = new Set(records.map(classifySource));
  if (sources.has('UNKNOWN')) return { ok: false, reason: 'a record has an ambiguous source — failing closed' };
  const hasLive = sources.has('LIVE');
  const hasNonLive = sources.has('FIXTURE') || sources.has('SANDBOX');
  if (hasLive && hasNonLive) return { ok: false, reason: 'result set mixes live and fixture/sandbox data — failing closed' };
  for (const s of sources) { const v = assertSourceAllowed(mode, s); if (!v.ok) return v; }
  return { ok: true };
}
