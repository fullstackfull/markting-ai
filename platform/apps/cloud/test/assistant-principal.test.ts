import { describe, expect, it, vi } from 'vitest';

// The engine env must resolve to DEMO so the orchestrator uses the demo gatherer.
vi.mock('@/lib/markting/runtime-mode', async (orig) => {
  const mod = await orig<typeof import('@/lib/markting/runtime-mode')>();
  return { ...mod, resolveRuntimeMode: () => 'DEMO' as const };
});
vi.mock('@/lib/markting/env', async (orig) => {
  const mod = await orig<typeof import('@/lib/markting/env')>();
  return { ...mod, isDemoMode: () => true };
});

describe('Program 3 — orchestrator-backed assistant answer from a server principal', () => {
  it('answers a profitability question via the unified path (demo), DETERMINISTIC_ONLY', async () => {
    const { askAssistantForPrincipal } = await import('@/lib/cloud/intelligence');
    const answer = await askAssistantForPrincipal(
      { organizationId: 'org-1', userId: 'u-1', role: 'owner', scopes: ['tools:read'] },
      'Why did profitability decline and what should I do?',
    );
    expect(answer.intent).toBe('PROFITABILITY_DECLINE');
    expect(answer.source).toBe('DETERMINISTIC_ONLY');
    expect(answer.text.en).toContain('merchant-side');
    expect(answer.recommendationIds.length).toBeGreaterThanOrEqual(2);
    expect(answer.trustTier).toBe('SYNTHETIC');
  });
});
