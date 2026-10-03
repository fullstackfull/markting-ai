import { describe, expect, it } from 'vitest';
import { AiGateway, DEMO_GATEWAY_CONFIG, estimateCostMicros, type GatewayConfig } from '@/lib/markting/ai-gateway';
import { InMemoryUsageLedger } from '@/lib/markting/usage-ledger';
import type { EngineContext } from '@/lib/markting/engine-context';

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return { organizationId: 'org-1', userId: 'u-1', requestId: 'req-1', locale: 'ar', timezone: 'Asia/Riyadh', mode: 'LIVE_RECOMMENDATIONS', scope: 'recommend', ...over };
}
const NOW = 1_770_000_000_000;

describe('AI gateway (1I/1J)', () => {
  it('refuses a model whose provider is not allowlisted', () => {
    const cfg: GatewayConfig = { ...DEMO_GATEWAY_CONFIG, roleModels: { ...DEMO_GATEWAY_CONFIG.roleModels, FAST_ANALYSIS: { provider: 'rogue', model: 'x' } } };
    const gw = new AiGateway(cfg, new InMemoryUsageLedger());
    expect(() => gw.resolveModel('FAST_ANALYSIS')).toThrow(/not allowlisted/);
  });

  it('records a scripted/local call as free (zero cost, tokens unavailable) and attributes it to the org', async () => {
    const ledger = new InMemoryUsageLedger();
    const gw = new AiGateway(DEMO_GATEWAY_CONFIG, ledger);
    const out = await gw.invoke({ ctx: ctx(), role: 'FAST_ANALYSIS', feature: 'assistant_turn', now: NOW, run: async () => ({ value: 'answer', usage: { tokensAvailable: false }, localFallback: true }) });
    expect(out).toBe('answer');
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ organizationId: 'org-1', status: 'local_fallback', estimatedCostMicros: 0, tokensAvailable: false });
  });

  it('does not double-charge a retried request (same request_id + feature)', async () => {
    const ledger = new InMemoryUsageLedger();
    const gw = new AiGateway(DEMO_GATEWAY_CONFIG, ledger);
    await gw.invoke({ ctx: ctx(), role: 'FAST_ANALYSIS', feature: 'assistant_turn', now: NOW, run: async () => ({ value: 1, usage: { tokensAvailable: false } }) });
    await expect(gw.invoke({ ctx: ctx(), role: 'FAST_ANALYSIS', feature: 'assistant_turn', now: NOW, run: async () => ({ value: 2, usage: { tokensAvailable: false } }) }))
      .rejects.toMatchObject({ code: 'APPLY_IN_PROGRESS' });
    expect(ledger.rows).toHaveLength(1);
  });

  it('enforces the per-org request quota and records the rejection', async () => {
    const ledger = new InMemoryUsageLedger();
    const cfg: GatewayConfig = { ...DEMO_GATEWAY_CONFIG, quota: { windowMs: 3600_000, maxRequests: 2, maxCostMicros: 1e12 } };
    const gw = new AiGateway(cfg, ledger);
    for (const id of ['a', 'b']) await gw.invoke({ ctx: ctx({ requestId: id }), role: 'FAST_ANALYSIS', feature: 'f', now: NOW, run: async () => ({ value: id, usage: { tokensAvailable: false } }) });
    await expect(gw.invoke({ ctx: ctx({ requestId: 'c' }), role: 'FAST_ANALYSIS', feature: 'f', now: NOW, run: async () => ({ value: 'c', usage: { tokensAvailable: false } }) }))
      .rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    expect(ledger.rows.some((r) => r.status === 'quota_exceeded')).toBe(true);
  });

  it('estimates cost from tokens only when tokens are available and a price is configured', () => {
    const cfg: GatewayConfig = { ...DEMO_GATEWAY_CONFIG, pricePer1kMicros: { 'm': { input: 3000, output: 15000 } } };
    expect(estimateCostMicros(cfg, 'm', { tokensAvailable: false })).toBe(0);
    expect(estimateCostMicros(cfg, 'm', { tokensAvailable: true, inputTokens: 1000, outputTokens: 1000 })).toBe(18000);
    expect(estimateCostMicros(cfg, 'unpriced', { tokensAvailable: true, inputTokens: 1000 })).toBe(0);
  });

  it('records a captured-token live call with a non-zero estimated cost', async () => {
    const ledger = new InMemoryUsageLedger();
    const cfg: GatewayConfig = { ...DEMO_GATEWAY_CONFIG, roleModels: { ...DEMO_GATEWAY_CONFIG.roleModels, DEEP_ANALYSIS: { provider: 'anthropic', model: 'm' } }, pricePer1kMicros: { 'm': { input: 3000, output: 15000 } } };
    const gw = new AiGateway(cfg, ledger);
    await gw.invoke({ ctx: ctx({ requestId: 'live-1' }), role: 'DEEP_ANALYSIS', feature: 'deep', now: NOW, run: async () => ({ value: 'ok', usage: { tokensAvailable: true, inputTokens: 2000, outputTokens: 1000 }, latencyMs: 1234 }) });
    expect(ledger.rows[0]).toMatchObject({ status: 'ok', provider: 'anthropic', model: 'm', estimatedCostMicros: 21000, tokensAvailable: true, latencyMs: 1234 });
  });
});
