import { describe, expect, it } from 'vitest';
import {
  runAIFailover, InMemoryBreakerRegistry, DEFAULT_BREAKER_CONFIG,
  type FailoverResult,
} from '@/lib/markting/ops/ai-failover';
import {
  FakeAIProviderAdapter, BlockedExternalAIProviderAdapter, BlockedExternalError, ANTHROPIC_DESCRIPTOR,
  OPENAI_DESCRIPTOR, type AICompletionRequest, type AINormalizedCompletion,
} from '@/lib/markting/ops/ai-provider-adapter';
import { ProviderSignal } from '@/lib/markting/ops/provider-executor';
import type { ModelDescriptor } from '@/lib/markting/ai-gateway';

const model: ModelDescriptor = { provider: 'x', model: 'm' };
const request: AICompletionRequest = { role: 'DEEP_ANALYSIS', model, input: 'analyze' };

function fixedClock(t = 1_000): () => number {
  return () => t;
}
const fallback = (): AINormalizedCompletion => ({ text: '[local-fallback]', usage: { tokensAvailable: false }, finishReason: 'local_fallback', provider: 'local', model: 'none', localFallback: true });

describe('C.6-33 — AI failover policy', () => {
  it('serves the first healthy candidate (OK)', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const r = await runAIFailover<AINormalizedCompletion>({
      candidates: [new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR })],
      request, breakers, now: fixedClock(),
    });
    expect(r.status).toBe('OK');
    expect(r.servedBy).toBe('anthropic');
    expect(r.attempts.map((a) => a.outcome)).toEqual(['SUCCESS']);
  });

  it('TRANSIENT on the first candidate falls through to the next, reporting backoff', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const first = new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR, fail: () => new ProviderSignal('TRANSIENT', 'blip') });
    const second = new FakeAIProviderAdapter({ provider: 'openai', descriptor: OPENAI_DESCRIPTOR });
    const r = await runAIFailover<AINormalizedCompletion>({ candidates: [first, second], request, breakers, now: fixedClock() });
    expect(r.status).toBe('OK');
    expect(r.servedBy).toBe('openai');
    expect(r.attempts[0]?.outcome).toBe('TRANSIENT');
    expect(r.attempts[0]?.backoffMs).toBeGreaterThan(0);
  });

  it('RATE_LIMIT honors the provider-advised backoff and tries the next', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const first = new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR, fail: () => new ProviderSignal('RATE_LIMIT', 'slow down', 7777) });
    const second = new FakeAIProviderAdapter({ provider: 'openai', descriptor: OPENAI_DESCRIPTOR });
    const r = await runAIFailover<AINormalizedCompletion>({ candidates: [first, second], request, breakers, now: fixedClock() });
    expect(r.attempts[0]).toMatchObject({ outcome: 'RATE_LIMIT', backoffMs: 7777 });
    expect(r.status).toBe('OK');
  });

  it('AUTH stops the whole failover (no later candidate tried)', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const first = new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR, fail: () => new ProviderSignal('AUTH', 'bad key') });
    const second = new FakeAIProviderAdapter({ provider: 'openai', descriptor: OPENAI_DESCRIPTOR });
    const r = await runAIFailover<AINormalizedCompletion>({ candidates: [first, second], request, breakers, now: fixedClock(), localFallback: fallback });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['AUTH']);
    expect(r.status).toBe('DEGRADED_LOCAL_FALLBACK');
    expect(r.value?.localFallback).toBe(true);
  });

  it('BLOCKED_EXTERNAL candidate is skipped without tripping its breaker', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const real = new BlockedExternalAIProviderAdapter(ANTHROPIC_DESCRIPTOR);
    const r = await runAIFailover<AINormalizedCompletion>({ candidates: [real], request, breakers, now: fixedClock(), localFallback: fallback });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['BLOCKED_EXTERNAL']);
    expect(r.status).toBe('DEGRADED_LOCAL_FALLBACK');
    expect(breakers.get('anthropic').state).toBe('closed'); // not penalized
    expect(breakers.get('anthropic').consecutiveFailures).toBe(0);
  });

  it('exhausting all candidates with no fallback yields STOPPED (never a fabricated success)', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const a = new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR, fail: () => new ProviderSignal('TRANSIENT', 'x') });
    const b = new FakeAIProviderAdapter({ provider: 'openai', descriptor: OPENAI_DESCRIPTOR, fail: () => new BlockedExternalError('not wired') });
    const r: FailoverResult<AINormalizedCompletion> = await runAIFailover({ candidates: [a, b], request, breakers, now: fixedClock() });
    expect(r.status).toBe('STOPPED');
    expect(r.value).toBeUndefined();
    expect(r.localFallback).toBe(false);
  });

  it('trips the breaker open after the failure threshold, then skips while cooling down', async () => {
    const breakers = new InMemoryBreakerRegistry();
    const cfg = { failureThreshold: 2, cooldownMs: 10_000 };
    const always = () => new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR, fail: () => new ProviderSignal('TRANSIENT', 'x') });
    // Two failures at t=0 trip it open.
    await runAIFailover<AINormalizedCompletion>({ candidates: [always()], request, breakers, breakerConfig: cfg, now: () => 0 });
    expect(breakers.get('anthropic').state).toBe('closed'); // 1 failure
    await runAIFailover<AINormalizedCompletion>({ candidates: [always()], request, breakers, breakerConfig: cfg, now: () => 0 });
    expect(breakers.get('anthropic').state).toBe('open'); // 2nd failure -> open

    // Inside cooldown: skipped as BREAKER_OPEN, stays open.
    const skipped = await runAIFailover<AINormalizedCompletion>({ candidates: [always()], request, breakers, breakerConfig: cfg, now: () => 5_000, localFallback: fallback });
    expect(skipped.attempts.map((a) => a.outcome)).toEqual(['BREAKER_OPEN']);
    expect(skipped.status).toBe('DEGRADED_LOCAL_FALLBACK');
    expect(breakers.get('anthropic').state).toBe('open');

    // After cooldown: a success half-opens then closes the breaker.
    const recover = await runAIFailover<AINormalizedCompletion>({
      candidates: [new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR })],
      request, breakers, breakerConfig: cfg, now: () => 20_000,
    });
    expect(recover.status).toBe('OK');
    expect(breakers.get('anthropic').state).toBe('closed');
  });

  it('a half_open trial that fails re-opens the breaker', async () => {
    const breakers = new InMemoryBreakerRegistry();
    breakers.set('anthropic', { state: 'open', consecutiveFailures: 3, openedAtMs: 0 });
    const r = await runAIFailover<AINormalizedCompletion>({
      candidates: [new FakeAIProviderAdapter({ provider: 'anthropic', descriptor: ANTHROPIC_DESCRIPTOR, fail: () => new ProviderSignal('TRANSIENT', 'x') })],
      request, breakers, breakerConfig: DEFAULT_BREAKER_CONFIG, now: () => 1_000_000, localFallback: fallback,
    });
    expect(r.attempts[0]?.outcome).toBe('TRANSIENT'); // admitted for a half_open trial
    expect(breakers.get('anthropic').state).toBe('open'); // trial failed -> re-open
  });
});
