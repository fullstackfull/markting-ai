/**
 * Phase 7N/7O — OBSERVABILITY event model + alert rules + SLO definitions. Structured, correlated,
 * tenant-aware, SECRET-REDACTED. This is the in-process model (metrics/log/trace shapes + alert
 * deduplication + SLO targets); a real metrics backend is wired at the edge in production.
 */
export type MetricName =
  | 'request_latency_ms' | 'error_rate' | 'provider_latency_ms' | 'provider_error_rate'
  | 'ai_latency_ms' | 'ai_cost_micros' | 'sync_delay_ms' | 'queue_depth' | 'approval_aging_ms'
  | 'write_success' | 'write_failure' | 'unknown_result_count' | 'tenant_usage';

export interface MetricPoint { name: MetricName; value: number; organizationId?: string; labels?: Record<string, string>; at: string }

const SECRET_KEYS = ['token', 'secret', 'password', 'authorization', 'access_token', 'refresh_token', 'api_key', 'key'];

/** Redact secret-looking fields from a log payload before it is emitted. */
export function redactLog<T>(payload: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEYS.some((s) => k.toLowerCase().includes(s)) ? '[REDACTED]' : walk(val);
      return out;
    }
    return v;
  };
  return walk(payload) as T;
}

export interface TraceSpan { name: string; traceId: string; parentId?: string; organizationId?: string; startedAt: string; endedAt?: string; attributes?: Record<string, string> }

/** The canonical end-to-end trace stages for a governed write. */
export const TRACE_STAGES = ['user_request', 'analysis', 'recommendation', 'preview', 'approval', 'provider_write', 'outcome'] as const;

// ---- SLOs (internal targets; not customer SLA commitments) ----
export const SLO_TARGETS = {
  api_availability_pct: 99.5,
  read_sync_freshness_minutes: 30,
  recommendation_availability_pct: 99.0,
  approval_service_latency_ms_p95: 1000,
  write_processing_latency_ms_p95: 5000,
} as const;

// ---- Alerting with dedup ----
export const ALERT_RULES = [
  'failed_provider_write', 'unknown_result', 'repeated_oauth_failure', 'sync_stuck', 'db_error',
  'kill_switch_triggered', 'quota_exhausted', 'high_ai_cost', 'webhook_verification_failure',
  'backup_failure', 'migration_failure',
] as const;
export type AlertRule = (typeof ALERT_RULES)[number];

export interface Alert { rule: AlertRule; key: string; message: string; at: string }

/** Deduplicate alerts within a window so one incident does not storm (same rule+key collapses). */
export function dedupeAlerts(alerts: Alert[], windowMs = 300_000): Alert[] {
  const seen = new Map<string, number>();
  const out: Alert[] = [];
  for (const a of [...alerts].sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
    const k = `${a.rule}:${a.key}`;
    const last = seen.get(k);
    const t = Date.parse(a.at);
    if (last == null || t - last > windowMs) { out.push(a); seen.set(k, t); }
  }
  return out;
}
