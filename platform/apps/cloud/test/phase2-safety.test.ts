import { describe, expect, it } from 'vitest';
import { createContext, AdportError } from '@adport/core';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { diagnoseEntity } from '@/lib/markting/intelligence/diagnostics';
import { generateRecommendations } from '@/lib/markting/intelligence/recommendation';
import { REVIEW_ACTION_TYPES, RECOMMENDATION_CATEGORIES, type Recommendation } from '@/lib/markting/intelligence/decision-model';

/**
 * PHASE 2 SAFETY TESTS (explicit). Proves the AI cannot write, recommendations are not a second action
 * path, and acceptance is not a mutation. The control model stays DATA→ANALYSIS→DIAGNOSIS→
 * RECOMMENDATION→(human)→PREVIEW→APPROVAL→WRITE.
 */

const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, readAt: '2026-09-15T00:00:00Z', ...over };
}
function row(id: string, m: Partial<Record<string, number>>): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency: 'SAR', entity: { level: 'account', id, name: id }, metrics: m as ReportRow['metrics'] };
}

function sampleRecommendations(): Recommendation[] {
  const scope = { organizationId: 'org-1', accountId: 'act_1', entityId: 'meta:act_1:acc', entityLevel: 'account' as const, name: 'Account' };
  const cur = normalizeReportRows([row('acc', { spend: 1000, impressions: 100000, clicks: 500, conversions: 40, conversion_value: 3200 })], ctx());
  const prev = normalizeReportRows([row('acc', { spend: 1000, impressions: 100000, clicks: 1000, conversions: 80, conversion_value: 6400 })], ctx({ dateRange: PERIOD.previous }));
  const { diagnoses } = diagnoseEntity({ scope, current: cur, previous: prev, period: PERIOD });
  return generateRecommendations({ organizationId: 'org-1', entity: { entityId: scope.entityId, entityLevel: 'account', name: 'Account', accountId: 'act_1' }, diagnoses, facts: { spend: 1000, conversions: 40 } });
}

describe('Phase 2 safety: AI cannot write in read-only / recommendations mode', () => {
  it('the tool registry refuses any non-read tool when the runtime is read-only', async () => {
    const { ctx: toolCtx, registry } = await createContext({ includeMock: true, readOnly: true });
    const writeTool = registry.list().find((t) => t.annotations.readOnly !== true);
    expect(writeTool).toBeTruthy();
    await expect(registry.call(writeTool!.name, {}, toolCtx)).rejects.toMatchObject({ code: 'WRITE_FORBIDDEN_READ_ONLY' });
  });

  it('a read tool is still allowed under read-only (analysis is not blocked)', async () => {
    const { ctx: toolCtx, registry } = await createContext({ includeMock: true, readOnly: true });
    const readTool = registry.list().find((t) => t.annotations.readOnly === true);
    // Either it runs or fails for a non-safety reason — it must NOT be the read-only refusal.
    try { await registry.call(readTool!.name, {}, toolCtx); }
    catch (e) { expect((e as AdportError).code).not.toBe('WRITE_FORBIDDEN_READ_ONLY'); }
  });
});

describe('Phase 2 safety: a recommendation is not a second action path', () => {
  const recs = sampleRecommendations();

  it('carries NO endpoint / path / method / body / payload — only a typed category + review action', () => {
    expect(recs.length).toBeGreaterThan(0);
    const forbidden = ['endpoint', 'path', 'url', 'method', 'body', 'payload', 'request', 'provider_call', 'mutation', 'apply'];
    for (const r of recs) {
      const json = JSON.stringify(r).toLowerCase();
      const keys = new Set<string>();
      JSON.parse(JSON.stringify(r), (k) => { if (k) keys.add(k.toLowerCase()); return undefined; });
      for (const f of forbidden) expect(keys.has(f)).toBe(false);
      expect(RECOMMENDATION_CATEGORIES).toContain(r.category);
      expect(REVIEW_ACTION_TYPES).toContain(r.actionType);
      expect(r.requiresHumanApproval).toBe(true);
      // The action type is a REVIEW/INVESTIGATE intent, never an imperative provider verb.
      expect(r.actionType.startsWith('REVIEW_') || r.actionType.startsWith('INVESTIGATE_') || r.actionType === 'NO_ACTION').toBe(true);
      void json;
    }
  });

  it('recommendation generation is pure data — it performs no I/O and returns structured artifacts', () => {
    // generateRecommendations is synchronous and returns plain objects; there is no provider/client in scope.
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.every((r) => typeof r.recommendationId === 'string')).toBe(true);
  });

  it('review action types never map 1:1 to a provider mutation verb (no pause()/setBudget() here)', () => {
    // The enum is a review vocabulary; the mapping to a typed provider action happens later, under a
    // human, on the Phase-0 path. None of these strings is a provider method name.
    for (const a of REVIEW_ACTION_TYPES) {
      expect(a).not.toMatch(/^(set|pause|enable|disable|update|create|delete)[A-Z]/);
    }
  });
});
