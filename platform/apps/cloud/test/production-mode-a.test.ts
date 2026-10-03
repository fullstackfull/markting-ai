import { describe, expect, it } from 'vitest';
import { isModeA, resolveCapabilities, assertProviderWriteAllowed, providerWritesPossible, ProviderWriteBlockedError } from '@/lib/markting/ops/mode-a';
import { classifySource, assertSourceAllowed, assertNoMixedSources } from '@/lib/markting/ops/source-guard';
import { canApply, canPreview } from '@/lib/markting/runtime-mode';
import { canExecute } from '@/lib/markting/ops/rbac';
import type { DataTrust } from '@/lib/markting/data-trust';

describe('Stage 10 — Mode A provider-write lockdown (every mutation attempt fails)', () => {
  const modeA = ['LIVE_READ_ONLY', 'LIVE_RECOMMENDATIONS'] as const;
  it('Mode A permits read + (recommendations) but NEVER provider writes', () => {
    for (const m of modeA) {
      expect(isModeA(m)).toBe(true);
      const caps = resolveCapabilities(m);
      expect(caps.readProviders).toBe(true);
      expect(caps.applyWrites).toBe(false);
      expect(caps.previewWrites).toBe(false);
      expect(providerWritesPossible(m)).toBe(false);
      expect(canApply(m)).toBe(false);
    }
  });
  it('any provider-mutation attempt in Mode A throws, whatever the caller', () => {
    for (const m of modeA) {
      for (const caller of ['user_ask_change_budget', 'ai_requests_pause', 'service_account_write', 'direct_write_route', 'mcp_write_request']) {
        expect(() => assertProviderWriteAllowed(m, caller)).toThrow(ProviderWriteBlockedError);
      }
    }
  });
  it('the AI/model can never execute (independent of mode)', () => {
    expect(canExecute({ userId: 'ai', roles: ['OWNER'], isModel: true }).ok).toBe(false);
    expect(canExecute({ userId: 'svc', roles: ['OWNER'], isServiceAccount: true } as never).ok).toBeDefined(); // service acct: perm-gated, not model
  });
  it('LIVE_RECOMMENDATIONS gives recommendations but LIVE_READ_ONLY does not; neither previews writes', () => {
    expect(resolveCapabilities('LIVE_RECOMMENDATIONS').recommend).toBe(true);
    expect(resolveCapabilities('LIVE_READ_ONLY').recommend).toBe(false);
    expect(canPreview('LIVE_RECOMMENDATIONS')).toBe(false);
  });
  it('only the Phase-0 ceiling (Mode B) could ever permit a write', () => {
    expect(providerWritesPossible('LIVE_WRITE_APPROVAL_ONLY')).toBe(true);
    expect(() => assertProviderWriteAllowed('LIVE_WRITE_APPROVAL_ONLY', 'governed_apply')).not.toThrow();
    expect(providerWritesPossible('LIVE_WRITE_DISABLED')).toBe(false);
  });
});

describe('Stage 24 — no hidden demo data (source separation, fail closed)', () => {
  const t = (tier: DataTrust['tier'], source: string): Pick<DataTrust, 'tier' | 'source'> => ({ tier, source });
  it('classifies fixture / sandbox / live / unknown', () => {
    expect(classifySource(t('SYNTHETIC', 'sandbox-fixture'))).toBe('FIXTURE');
    expect(classifySource(t('SYNTHETIC', 'sandbox-provider'))).toBe('SANDBOX');
    expect(classifySource(t('PLATFORM_REPORTED', 'meta-report'))).toBe('LIVE');
    expect(classifySource(t('VALIDATED', 'reconciled-report'))).toBe('LIVE');
    // a live tier whose source still smells synthetic is AMBIGUOUS → fail closed
    expect(classifySource(t('PLATFORM_REPORTED', 'demo-fixture'))).toBe('UNKNOWN');
  });
  it('a live deployment never surfaces fixture/sandbox data', () => {
    expect(assertSourceAllowed('LIVE_RECOMMENDATIONS', 'FIXTURE').ok).toBe(false);
    expect(assertSourceAllowed('LIVE_RECOMMENDATIONS', 'SANDBOX').ok).toBe(false);
    expect(assertSourceAllowed('LIVE_RECOMMENDATIONS', 'LIVE').ok).toBe(true);
  });
  it('a DEMO deployment never surfaces live data', () => {
    expect(assertSourceAllowed('DEMO', 'LIVE').ok).toBe(false);
    expect(assertSourceAllowed('DEMO', 'FIXTURE').ok).toBe(true);
  });
  it('ambiguous source always fails closed', () => {
    expect(assertSourceAllowed('LIVE_RECOMMENDATIONS', 'UNKNOWN').ok).toBe(false);
    expect(assertSourceAllowed('DEMO', 'UNKNOWN').ok).toBe(false);
  });
  it('a result set mixing live + fixture/sandbox fails closed', () => {
    const mixed = [t('PLATFORM_REPORTED', 'meta-report'), t('SYNTHETIC', 'sandbox-fixture')];
    expect(assertNoMixedSources('LIVE_RECOMMENDATIONS', mixed).ok).toBe(false);
    const allLive = [t('PLATFORM_REPORTED', 'meta-report'), t('VALIDATED', 'reconciled')];
    expect(assertNoMixedSources('LIVE_RECOMMENDATIONS', allLive).ok).toBe(true);
    const allFixture = [t('SYNTHETIC', 'sandbox-fixture'), t('SYNTHETIC', 'sandbox-fixture')];
    expect(assertNoMixedSources('DEMO', allFixture).ok).toBe(true);
  });
});
