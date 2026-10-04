import 'server-only';
import { db } from '@/lib/db';
import { platformDb } from '@/lib/platform/db';
import { sanitizeProviderResponse } from './sanitize';
import { detectSchemaDrift, type ProviderContract } from './schema-drift';

/**
 * PHASE C.6 (item 5) — DATA QUARANTINE.
 *
 * A PURE classifier plus a persistence store. The classifier decides whether a single candidate row is fit
 * to enter canonical intelligence, and the store records the ones that are not, in a deduplicated aggregate.
 *
 * THE INVARIANT: a quarantined row NEVER reaches canonical intelligence. The classifier is the single gate;
 * `partitionForQuarantine` / `ingestWithQuarantine` are the only sanctioned ways to admit rows, and both
 * route every quarantined row away from the accepted set. Nothing in this module "repairs" a bad row — a
 * quarantined row is dropped (recorded), not coerced.
 *
 * SAFETY: only a SANITIZER-redacted sample is ever persisted (lib/markting/ops/sanitize.ts). A raw secret,
 * token, or full-PII value can never land in the store because the redaction happens before the write.
 */

export const QUARANTINE_REASONS = [
  'MALFORMED_ROW',
  'SCHEMA_DRIFT',
  'IMPOSSIBLE_VALUE',
  'OWNERSHIP_MISMATCH',
  'UNSUPPORTED_CURRENCY',
  'INVALID_TIMESTAMP',
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/** The adjudication context. Every field is optional — a check only runs when its input is supplied. */
export interface QuarantineContext {
  provider: string;
  /** For OWNERSHIP_MISMATCH — the org/account the batch is being ingested for. */
  expectedOrganizationId?: string;
  expectedAccountId?: string;
  /** For UNSUPPORTED_CURRENCY — the ISO-4217 codes canonical intelligence can account in. */
  supportedCurrencies?: readonly string[];
  /** For SCHEMA_DRIFT — the provider contract the normalizer parses against (reuses detectSchemaDrift). */
  contract?: ProviderContract;
  /** For INVALID_TIMESTAMP bounds — "now" in epoch ms (defaults to Date.now()). */
  nowMs?: number;
}

export interface QuarantineDecision {
  quarantined: boolean;
  reason?: QuarantineReason;
  /** A short, SAFE explanation (field path / bound) — never echoes a secret or full value. */
  detail?: string;
}

const ACCEPT: QuarantineDecision = { quarantined: false };

/** The earliest timestamp we treat as plausible for ad/commerce data (anything older is corrupt). */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
/** Rows must not be stamped meaningfully in the future (clock skew tolerance: 2 days). */
const FUTURE_SKEW_MS = 2 * 24 * 60 * 60 * 1000;

/** Non-negative numeric metrics — a negative value is impossible, not merely suspicious. */
const NON_NEGATIVE_FIELDS = [
  ['spend', 'spend'],
  ['impressions', 'impressions'],
  ['clicks', 'clicks'],
  ['conversions', 'conversions'],
  ['revenue', 'revenue'],
  ['cost', 'cost'],
  ['amount', 'amount'],
  ['quantity', 'quantity'],
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read the first present key among camelCase/snake_case aliases. */
function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n)) return row[n];
  }
  return undefined;
}

/** Coerce a value to a number only when it is a number or a numeric string; else undefined. */
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Parse a timestamp field to epoch ms: epoch-ms number, numeric string, or Date-parseable string. */
function parseTimestampMs(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const asEpoch = v.trim() !== '' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
    if (Number.isFinite(asEpoch)) return asEpoch;
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * THE GATE. Decide whether `row` may enter canonical intelligence. Pure: no I/O, no mutation. Checks run in
 * a fixed precedence so the FIRST disqualifying reason wins (structural problems before value problems).
 */
export function classifyForQuarantine(row: unknown, ctx: QuarantineContext): QuarantineDecision {
  // 1) MALFORMED_ROW — not a usable object at all.
  if (!isPlainObject(row) || Object.keys(row).length === 0) {
    return { quarantined: true, reason: 'MALFORMED_ROW', detail: 'row is not a non-empty object' };
  }

  // 2) SCHEMA_DRIFT — only a BREAKING drift quarantines (additive drift is surfaced elsewhere, not dropped).
  if (ctx.contract) {
    const report = detectSchemaDrift(ctx.contract, row);
    if (report.status === 'BREAKING') {
      const first = report.findings.find((f) => f.severity === 'BREAKING');
      return { quarantined: true, reason: 'SCHEMA_DRIFT', detail: first ? `${first.kind} @ ${first.path}` : 'breaking drift' };
    }
  }

  // 3) OWNERSHIP_MISMATCH — a row attributed to a different org/account than the batch is being ingested for.
  if (ctx.expectedOrganizationId !== undefined) {
    const owner = pick(row, 'organizationId', 'organization_id', 'orgId', 'org_id');
    if (owner !== undefined && owner !== null && String(owner) !== ctx.expectedOrganizationId) {
      return { quarantined: true, reason: 'OWNERSHIP_MISMATCH', detail: 'organizationId does not match ingest target' };
    }
  }
  if (ctx.expectedAccountId !== undefined) {
    const acct = pick(row, 'accountId', 'account_id', 'externalAccountId', 'external_account_id');
    if (acct !== undefined && acct !== null && String(acct) !== ctx.expectedAccountId) {
      return { quarantined: true, reason: 'OWNERSHIP_MISMATCH', detail: 'accountId does not match ingest target' };
    }
  }

  // 4) IMPOSSIBLE_VALUE — non-finite metrics, negative non-negatives, clicks exceeding impressions.
  for (const [camel, snake] of NON_NEGATIVE_FIELDS) {
    const raw = pick(row, camel, snake);
    if (raw === undefined || raw === null) continue;
    const n = asNumber(raw);
    if (n !== undefined && !Number.isFinite(n)) {
      return { quarantined: true, reason: 'IMPOSSIBLE_VALUE', detail: `${camel} is not finite` };
    }
    if (n !== undefined && n < 0) {
      return { quarantined: true, reason: 'IMPOSSIBLE_VALUE', detail: `${camel} is negative` };
    }
  }
  {
    const clicks = asNumber(pick(row, 'clicks'));
    const impressions = asNumber(pick(row, 'impressions'));
    if (clicks !== undefined && impressions !== undefined && clicks > impressions) {
      return { quarantined: true, reason: 'IMPOSSIBLE_VALUE', detail: 'clicks exceed impressions' };
    }
  }

  // 5) UNSUPPORTED_CURRENCY — a currency outside the canonical accounting set.
  if (ctx.supportedCurrencies && ctx.supportedCurrencies.length > 0) {
    const cur = pick(row, 'currency', 'currencyCode', 'currency_code');
    if (cur !== undefined && cur !== null) {
      const code = String(cur).toUpperCase();
      const supported = new Set(ctx.supportedCurrencies.map((c) => c.toUpperCase()));
      if (!supported.has(code)) {
        return { quarantined: true, reason: 'UNSUPPORTED_CURRENCY', detail: `currency ${code} not in supported set` };
      }
    }
  }

  // 6) INVALID_TIMESTAMP — unparseable, pre-2000, or meaningfully in the future.
  {
    const tsField = pick(row, 'timestamp', 'occurredAt', 'occurred_at', 'date', 'dateStart', 'date_start', 'eventTime', 'event_time');
    if (tsField !== undefined && tsField !== null) {
      const ms = parseTimestampMs(tsField);
      const now = ctx.nowMs ?? Date.now();
      if (ms === undefined) {
        return { quarantined: true, reason: 'INVALID_TIMESTAMP', detail: 'timestamp is unparseable' };
      }
      if (ms < MIN_PLAUSIBLE_MS || ms > now + FUTURE_SKEW_MS) {
        return { quarantined: true, reason: 'INVALID_TIMESTAMP', detail: 'timestamp is out of plausible range' };
      }
    }
  }

  return ACCEPT;
}

/**
 * Split a batch into the rows canonical intelligence may admit and the rows the gate rejected. PURE — this
 * is the provable form of the invariant: `accepted` contains NO row that classifies as quarantined.
 */
export function partitionForQuarantine<T>(
  rows: readonly T[],
  ctx: QuarantineContext,
): { accepted: T[]; quarantined: Array<{ row: T; reason: QuarantineReason; detail?: string }> } {
  const accepted: T[] = [];
  const quarantined: Array<{ row: T; reason: QuarantineReason; detail?: string }> = [];
  for (const row of rows) {
    const d = classifyForQuarantine(row, ctx);
    if (d.quarantined) quarantined.push({ row, reason: d.reason!, detail: d.detail });
    else accepted.push(row);
  }
  return { accepted, quarantined };
}

// --- Store ---------------------------------------------------------------------------------------------

export interface QuarantineObservation {
  organizationId: string;
  provider: string;
  accountId: string;
  reason: QuarantineReason;
  /** The offending row — REDACTED by the sanitizer before anything is persisted. */
  sampleRow: unknown;
  nowMs: number;
}

export interface QuarantineRecord {
  organizationId: string;
  provider: string;
  accountId: string;
  reason: QuarantineReason;
  count: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  /** A sanitizer-redacted structural sample — never a raw secret/PII. */
  redactedSample: unknown;
}

export interface QuarantineStore {
  /** Record one quarantined observation; deduplicates on (org, provider, account, reason), bumping count. */
  record(obs: QuarantineObservation): Promise<QuarantineRecord>;
}

/** Produce the SAFE redacted sample that is the only thing ever persisted. */
export function redactSample(sample: unknown, provider: string): unknown {
  return sanitizeProviderResponse(sample, { provider, apiVersion: 'n/a' }).sanitized;
}

function key(o: Pick<QuarantineObservation, 'organizationId' | 'provider' | 'accountId' | 'reason'>): string {
  return `${o.organizationId}|${o.provider}|${o.accountId}|${o.reason}`;
}

/** In-memory aggregate — deterministic, for unit tests (no DB). */
export class InMemoryQuarantineStore implements QuarantineStore {
  private recs = new Map<string, QuarantineRecord>();

  async record(obs: QuarantineObservation): Promise<QuarantineRecord> {
    const k = key(obs);
    const redactedSample = redactSample(obs.sampleRow, obs.provider);
    const existing = this.recs.get(k);
    const rec: QuarantineRecord = existing
      ? { ...existing, count: existing.count + 1, lastSeenAtMs: obs.nowMs, redactedSample }
      : {
          organizationId: obs.organizationId,
          provider: obs.provider,
          accountId: obs.accountId,
          reason: obs.reason,
          count: 1,
          firstSeenAtMs: obs.nowMs,
          lastSeenAtMs: obs.nowMs,
          redactedSample,
        };
    this.recs.set(k, rec);
    return { ...rec };
  }

  // test helper
  all(): QuarantineRecord[] {
    return [...this.recs.values()].map((r) => ({ ...r }));
  }
}

// db() applies postgres.camel.column, so reads come back camelCased; bigints arrive as strings.
type Row = {
  organizationId: string;
  provider: string;
  accountId: string;
  reason: QuarantineReason;
  count: string | number;
  firstSeenAtMs: string | number;
  lastSeenAtMs: string | number;
  redactedSample: unknown;
};
function rowToRecord(r: Row): QuarantineRecord {
  return {
    organizationId: r.organizationId,
    provider: r.provider,
    accountId: r.accountId,
    reason: r.reason,
    count: Number(r.count),
    firstSeenAtMs: Number(r.firstSeenAtMs),
    lastSeenAtMs: Number(r.lastSeenAtMs),
    // jsonb may round-trip as a string in this postgres config — parse defensively.
    redactedSample: typeof r.redactedSample === 'string'
      ? (() => { try { return JSON.parse(r.redactedSample as string); } catch { return r.redactedSample; } })()
      : r.redactedSample,
  };
}

/** Postgres-backed aggregate over public.markting_quarantine. Upsert bumps count + last-seen atomically. */
export class PostgresQuarantineStore implements QuarantineStore {
  async record(obs: QuarantineObservation): Promise<QuarantineRecord> {
    const redactedSample = redactSample(obs.sampleRow, obs.provider);
    const rows = await db()<Row[]>`
      insert into public.markting_quarantine
        (organization_id, provider, account_id, reason, count, redacted_sample, first_seen_at_ms, last_seen_at_ms)
      values (${obs.organizationId}, ${obs.provider}, ${obs.accountId}, ${obs.reason}, 1,
              ${JSON.stringify(redactedSample)}::jsonb, ${obs.nowMs}, ${obs.nowMs})
      on conflict (organization_id, provider, account_id, reason) do update
        set count = public.markting_quarantine.count + 1,
            last_seen_at_ms = ${obs.nowMs},
            redacted_sample = ${JSON.stringify(redactedSample)}::jsonb,
            updated_at = now()
      returning organization_id as "organizationId", provider, account_id as "accountId", reason, count,
                redacted_sample as "redactedSample", first_seen_at_ms as "firstSeenAtMs", last_seen_at_ms as "lastSeenAtMs"
    `;
    return rowToRecord(rows[0]!);
  }
}

/**
 * Classify a batch, RECORD every quarantined row into the store, and return only the accepted rows. This is
 * the sanctioned integration point for the executor/normalizer: canonical intelligence consumes `accepted`
 * and can never see a quarantined row.
 */
export async function ingestWithQuarantine<T>(
  rows: readonly T[],
  ctx: QuarantineContext,
  opts: { store: QuarantineStore; organizationId: string; accountId: string; nowMs: number },
): Promise<{ accepted: T[]; quarantinedCount: number }> {
  const { accepted, quarantined } = partitionForQuarantine(rows, ctx);
  for (const q of quarantined) {
    await opts.store.record({
      organizationId: opts.organizationId,
      provider: ctx.provider,
      accountId: opts.accountId,
      reason: q.reason,
      sampleRow: q.row,
      nowMs: opts.nowMs,
    });
  }
  return { accepted, quarantinedCount: quarantined.length };
}

// --- Reads (platform-admin, SELECT-only) ---------------------------------------------------------------

export interface QuarantineReasonTotal {
  reason: QuarantineReason;
  count: number;
}
export interface QuarantineSource {
  organizationId: string;
  provider: string;
  accountId: string;
  reason: QuarantineReason;
  count: number;
  lastSeenAtMs: number;
}
export interface QuarantineOverview {
  byReason: QuarantineReasonTotal[];
  recent: QuarantineSource[];
  total: number;
}

/**
 * Fleet quarantine counts + reasons for the admin data-quality page, via the platform-admin SELECT role.
 * Never surfaces the redacted sample to the UI — counts and routing facts only.
 */
export async function quarantineOverview(limit = 50): Promise<QuarantineOverview> {
  const bound = Math.min(Math.max(limit, 1), 200);
  const pdb = platformDb();
  const [byReason, recent] = await Promise.all([
    pdb<Array<{ reason: QuarantineReason; count: string | number }>>`
      select reason, coalesce(sum(count), 0)::bigint as count
      from public.markting_quarantine group by reason order by count desc`,
    pdb<Array<{ organizationId: string; provider: string; accountId: string; reason: QuarantineReason; count: string | number; lastSeenAtMs: string | number }>>`
      select organization_id as "organizationId", provider, account_id as "accountId", reason, count,
             last_seen_at_ms as "lastSeenAtMs"
      from public.markting_quarantine order by last_seen_at_ms desc limit ${bound}`,
  ]);
  const totals = byReason.map((r) => ({ reason: r.reason, count: Number(r.count) }));
  return {
    byReason: totals,
    recent: recent.map((r) => ({
      organizationId: r.organizationId,
      provider: r.provider,
      accountId: r.accountId,
      reason: r.reason,
      count: Number(r.count),
      lastSeenAtMs: Number(r.lastSeenAtMs),
    })),
    total: totals.reduce((s, r) => s + r.count, 0),
  };
}
