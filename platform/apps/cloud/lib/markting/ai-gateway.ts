import 'server-only';
import { AdportError } from '@adport/core';
import type { EngineContext } from './engine-context';
import type { UsageLedger, UsageRecord } from './usage-ledger';

/**
 * Minimal governed model gateway (Phase 1I). Server-side only — no model/provider key ever reaches
 * the browser. It is the single seam the model-bearing call passes through: model allowlist, per-org
 * attribution, request_id, timeout, bounded retry, usage/cost capture, and per-plan quotas. It is NOT
 * a second action path: it only governs read/analysis model calls; writes remain on the Phase-0
 * policy-engine path and are unreachable from here.
 *
 * We chose a native wrapper over LiteLLM for Phase 1 (see docs/phase1/06): there is no live model
 * traffic yet (demo is scripted/free), the engine already centralizes model construction, and adding
 * an always-on gateway service now would create a second provider-talking surface. The abstraction
 * below is the structural seam a LiteLLM-or-equivalent backend can slot behind later without changing
 * callers.
 */
export type ModelRole = 'FAST_ANALYSIS' | 'DEEP_ANALYSIS' | 'REPORT_GENERATION';

export interface ModelDescriptor { provider: string; model: string }
export interface GatewayConfig {
  /** Allowed models per role. A role resolving outside this map is refused. */
  roleModels: Record<ModelRole, ModelDescriptor>;
  /** Allowlisted provider ids. */
  providerAllowlist: ReadonlySet<string>;
  timeoutMs: number;
  maxRetries: number;
  /** Per-plan rolling quota over the window. */
  quota: { windowMs: number; maxRequests: number; maxCostMicros: number };
  /** Micros of billing currency per 1k input/output tokens, by model, for the estimate only. */
  pricePer1kMicros?: Record<string, { input: number; output: number }>;
}

export interface GatewayUsage { inputTokens?: number; outputTokens?: number; cachedTokens?: number; tokensAvailable: boolean }
export interface GatewayResult<T> { value: T; usage: GatewayUsage; localFallback?: boolean; latencyMs?: number }

/** The demo/scripted path reports no tokens and is free. Live calls populate usage when available. */
export function estimateCostMicros(cfg: GatewayConfig, model: string, usage: GatewayUsage): number {
  if (!usage.tokensAvailable) return 0;
  const price = cfg.pricePer1kMicros?.[model];
  if (!price) return 0;
  return Math.round(((usage.inputTokens ?? 0) / 1000) * price.input + ((usage.outputTokens ?? 0) / 1000) * price.output);
}

export interface InvokeOptions<T> {
  ctx: EngineContext;
  role: ModelRole;
  feature: string;
  /** The governed model-bearing call (e.g. the engine chat turn). */
  run: (model: ModelDescriptor) => Promise<GatewayResult<T>>;
  /** Monotonic clock (ms) — injected so tests are deterministic. */
  now: number;
}

export class AiGateway {
  constructor(private readonly cfg: GatewayConfig, private readonly ledger: UsageLedger) {}

  resolveModel(role: ModelRole): ModelDescriptor {
    const desc = this.cfg.roleModels[role];
    if (!desc) throw new AdportError('INVALID_INPUT', `No model configured for role ${role}`);
    if (!this.cfg.providerAllowlist.has(desc.provider)) {
      throw new AdportError('PROVIDER_ERROR', `Model provider ${desc.provider} is not allowlisted`);
    }
    return desc;
  }

  async invoke<T>(opts: InvokeOptions<T>): Promise<T> {
    const { ctx, role, feature } = opts;
    const model = this.resolveModel(role);

    // Idempotency: a retry with the same request_id+feature does not re-charge or re-run.
    if (await this.ledger.has(ctx.organizationId, ctx.requestId, feature)) {
      throw new AdportError('APPLY_IN_PROGRESS', `AI request ${ctx.requestId} for ${feature} was already recorded; not re-running.`);
    }

    // Quota (rolling window). Cost quota counts only chargeable calls (local fallback excluded).
    const sinceIso = new Date(opts.now - this.cfg.quota.windowMs).toISOString();
    const win = await this.ledger.usageSince(ctx.organizationId, sinceIso);
    if (win.requests >= this.cfg.quota.maxRequests || win.costMicros >= this.cfg.quota.maxCostMicros) {
      await this.ledger.record(this.row(ctx, feature, model, { tokensAvailable: false }, 'quota_exceeded', 0, 0));
      throw new AdportError('POLICY_VIOLATION', 'AI usage quota exceeded for this organization; try again later or upgrade the plan.');
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        const result = await this.withTimeout(opts.run(model), this.cfg.timeoutMs);
        const status = result.localFallback ? 'local_fallback' : 'ok';
        const cost = result.localFallback ? 0 : estimateCostMicros(this.cfg, model.model, result.usage);
        await this.ledger.record(this.row(ctx, feature, model, result.usage, status, cost, result.latencyMs));
        return result.value;
      } catch (err) {
        lastErr = err;
      }
    }
    await this.ledger.record(this.row(ctx, feature, model, { tokensAvailable: false }, 'error', 0, 0));
    throw lastErr instanceof Error ? lastErr : new AdportError('PROVIDER_ERROR', 'model call failed');
  }

  private row(ctx: EngineContext, feature: string, model: ModelDescriptor, usage: GatewayUsage, status: UsageRecord['status'], cost: number, latencyMs?: number): UsageRecord {
    return {
      organizationId: ctx.organizationId, userId: ctx.userId, requestId: ctx.requestId, threadId: ctx.threadId,
      feature, model: model.model, provider: model.provider,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedTokens: usage.cachedTokens,
      latencyMs, status, estimatedCostMicros: cost, tokensAvailable: usage.tokensAvailable,
    };
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AdportError('PROVIDER_ERROR', `model call exceeded ${ms}ms`)), ms); });
    try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer!); }
  }
}

/** Demo-safe default: a scripted local model, free, single allowed provider. */
export const DEMO_GATEWAY_CONFIG: GatewayConfig = {
  roleModels: {
    FAST_ANALYSIS: { provider: 'scripted', model: 'scripted-demo' },
    DEEP_ANALYSIS: { provider: 'scripted', model: 'scripted-demo' },
    REPORT_GENERATION: { provider: 'scripted', model: 'scripted-demo' },
  },
  providerAllowlist: new Set(['scripted', 'anthropic', 'openai']),
  timeoutMs: 240_000,
  maxRetries: 1,
  quota: { windowMs: 24 * 3600_000, maxRequests: 1000, maxCostMicros: 50_000_000 },
};
