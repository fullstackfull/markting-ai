import 'server-only';
import { db } from '@/lib/db';

/** One recorded model interaction. Estimated cost is micros of the billing currency, never invoice truth. */
export interface UsageRecord {
  organizationId: string;
  userId?: string;
  requestId: string;
  threadId?: string;
  feature: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  latencyMs?: number;
  status: 'ok' | 'error' | 'local_fallback' | 'quota_exceeded';
  estimatedCostMicros: number;
  tokensAvailable: boolean;
}

export interface UsageWindow { requests: number; costMicros: number }

/** Storage contract so the gateway logic is testable with an in-memory ledger and durable in prod. */
export interface UsageLedger {
  /** Idempotent upsert keyed by (organizationId, requestId, feature): a retry records once. */
  record(entry: UsageRecord): Promise<void>;
  /** True if a usage row already exists for this (org, requestId, feature). */
  has(organizationId: string, requestId: string, feature: string): Promise<boolean>;
  /** Rolling usage for an org within the trailing window (for quota checks). */
  usageSince(organizationId: string, sinceIso: string): Promise<UsageWindow>;
}

export class InMemoryUsageLedger implements UsageLedger {
  rows: UsageRecord[] = [];
  /** Insertion time per row (parallel to `rows`), so usageSince can honor the trailing window. */
  private times: number[] = [];
  /** Overridable clock for deterministic window tests. */
  now: () => number = () => Date.now();
  async record(entry: UsageRecord): Promise<void> {
    const i = this.rows.findIndex((r) => r.organizationId === entry.organizationId && r.requestId === entry.requestId && r.feature === entry.feature);
    if (i >= 0) { this.rows[i] = entry; this.times[i] = this.now(); } else { this.rows.push(entry); this.times.push(this.now()); }
  }
  async has(organizationId: string, requestId: string, feature: string): Promise<boolean> {
    return this.rows.some((r) => r.organizationId === organizationId && r.requestId === requestId && r.feature === feature);
  }
  async usageSince(organizationId: string, sinceIso: string): Promise<UsageWindow> {
    const since = Date.parse(sinceIso);
    const matched = this.rows.filter((r, i) =>
      r.organizationId === organizationId && r.status !== 'local_fallback' && (!Number.isFinite(since) || this.times[i]! >= since));
    return { requests: matched.length, costMicros: matched.reduce((a, r) => a + r.estimatedCostMicros, 0) };
  }
}

export class PostgresUsageLedger implements UsageLedger {
  async record(e: UsageRecord): Promise<void> {
    await db()`
      insert into public.markting_ai_usage
        (organization_id, user_id, request_id, thread_id, feature, model, provider,
         input_tokens, output_tokens, cached_tokens, latency_ms, status, estimated_cost_micros, tokens_available)
      values
        (${e.organizationId}, ${e.userId ?? null}, ${e.requestId}, ${e.threadId ?? null}, ${e.feature}, ${e.model}, ${e.provider},
         ${e.inputTokens ?? null}, ${e.outputTokens ?? null}, ${e.cachedTokens ?? null}, ${e.latencyMs ?? null},
         ${e.status}, ${e.estimatedCostMicros}, ${e.tokensAvailable})
      on conflict (organization_id, request_id, feature) do update set
        status = excluded.status, latency_ms = excluded.latency_ms,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cached_tokens = excluded.cached_tokens, estimated_cost_micros = excluded.estimated_cost_micros,
        tokens_available = excluded.tokens_available
    `;
  }
  async has(organizationId: string, requestId: string, feature: string): Promise<boolean> {
    const rows = await db()<Array<{ one: number }>>`
      select 1 as one from public.markting_ai_usage
      where organization_id = ${organizationId} and request_id = ${requestId} and feature = ${feature} limit 1`;
    return rows.length > 0;
  }
  async usageSince(organizationId: string, sinceIso: string): Promise<UsageWindow> {
    const rows = await db()<Array<{ requests: number; cost: number }>>`
      select count(*)::int as requests, coalesce(sum(estimated_cost_micros), 0)::bigint as cost
      from public.markting_ai_usage
      where organization_id = ${organizationId} and status <> 'local_fallback' and created_at >= ${sinceIso}`;
    return { requests: Number(rows[0]?.requests ?? 0), costMicros: Number(rows[0]?.cost ?? 0) };
  }
}
