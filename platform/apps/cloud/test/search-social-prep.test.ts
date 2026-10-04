import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_THRESHOLDS,
  SEARCH_DIAGNOSTICS_MODE,
  runSearchDiagnostics,
  searchTermNegativeCandidates,
  wastedSpendCandidates,
  lowQualityScoreSignals,
  type CanonicalSearchRow,
  type ReviewOnlySuggestion,
  type SearchSuggestion,
} from '@/lib/markting/ops/search-diagnostics-prep';
import {
  MIN_SIGNALS_FOR_FATIGUE,
  classifyCreativeHealth,
  detectFatigueSignals,
  type CreativeWindow,
} from '@/lib/markting/ops/social-diagnostics-prep';

/**
 * PHASE C.6 (items 9,10) — SEARCH (REVIEW_ONLY) + SOCIAL (multi-signal fatigue) DIAGNOSTICS.
 *
 * Pure diagnostics over canonical rows. Item 9 surfaces advisory suggestions and NEVER applies a change;
 * item 10 requires >= 2 independent signals before a FATIGUE verdict. No credentials, no network, no LLM.
 */

describe('C.6/9 — search diagnostics are REVIEW_ONLY', () => {
  it('declares REVIEW_ONLY mode', () => {
    expect(SEARCH_DIAGNOSTICS_MODE).toBe('REVIEW_ONLY');
  });

  it('every emitted suggestion is reviewOnly:true with a descriptive (non-executable) action', () => {
    const rows: CanonicalSearchRow[] = [
      { entityId: 'kw1', searchTerm: 'free stuff', metrics: { spend: 200, clicks: 60, conversions: 0 }, qualityScore: 2 },
    ];
    const all = runSearchDiagnostics(rows);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.reviewOnly).toBe(true);
      expect(typeof s.recommendedAction).toBe('string');
      // No executable/mutation affordance exists on the object.
      expect('apply' in s).toBe(false);
      expect('execute' in s).toBe(false);
      expect('mutate' in s).toBe(false);
    }
  });

  it('type-level guard: a suggestion can never represent an auto-apply', () => {
    // ReviewOnlySuggestion = NoAutoApply<SearchSuggestion>; if this compiles, no apply field is possible.
    const s: ReviewOnlySuggestion = {
      kind: 'WASTED_SPEND',
      entityId: 'e',
      finding: 'f',
      evidence: {},
      recommendedAction: 'review',
      confidence: 'LOW',
      reviewOnly: true,
    };
    const asBase: SearchSuggestion = s;
    expect(asBase.reviewOnly).toBe(true);
  });

  it('wasted-spend: flags spend with zero conversions above threshold only', () => {
    const rows: CanonicalSearchRow[] = [
      { entityId: 'a', metrics: { spend: 100, conversions: 0 } },
      { entityId: 'b', metrics: { spend: 100, conversions: 3 } },
      { entityId: 'c', metrics: { spend: 10, conversions: 0 } },
    ];
    const out = wastedSpendCandidates(rows);
    expect(out.map((s) => s.entityId)).toEqual(['a']);
    expect(out[0]?.evidence.spend).toBe(100);
  });

  it('low-quality-score: flags only rows at/below the threshold', () => {
    const rows: CanonicalSearchRow[] = [
      { entityId: 'a', metrics: {}, qualityScore: 2 },
      { entityId: 'b', metrics: {}, qualityScore: 8 },
      { entityId: 'c', metrics: {} },
    ];
    expect(lowQualityScoreSignals(rows).map((s) => s.entityId)).toEqual(['a']);
  });

  it('search-term-to-negative: needs a search term, clicks over threshold, and zero conversions', () => {
    const rows: CanonicalSearchRow[] = [
      { entityId: 'a', searchTerm: 'cheap junk', metrics: { clicks: 50, conversions: 0 } },
      { entityId: 'b', searchTerm: 'good term', metrics: { clicks: 50, conversions: 4 } },
      { entityId: 'c', metrics: { clicks: 50, conversions: 0 } }, // no search term
      { entityId: 'd', searchTerm: 'low clicks', metrics: { clicks: 5, conversions: 0 } },
    ];
    const out = searchTermNegativeCandidates(rows);
    expect(out.map((s) => s.entityId)).toEqual(['a']);
    expect(out[0]?.evidence.searchTerm).toBe('cheap junk');
  });

  it('thresholds are the conservative documented defaults', () => {
    expect(DEFAULT_SEARCH_THRESHOLDS.wastedSpendMinSpend).toBeGreaterThan(0);
    expect(DEFAULT_SEARCH_THRESHOLDS.negativeCandidateMinClicks).toBeGreaterThan(0);
  });
});

describe('C.6/10 — social fatigue requires MULTIPLE independent signals', () => {
  it('MIN_SIGNALS_FOR_FATIGUE is at least 2', () => {
    expect(MIN_SIGNALS_FOR_FATIGUE).toBeGreaterThanOrEqual(2);
  });

  const prior: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 2.0, ctr: 2.0, cpm: 10.0 } };

  it('a SINGLE signal yields WATCH, never FATIGUE', () => {
    // Only frequency rises; ctr and cpm steady.
    const current: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 3.0, ctr: 2.0, cpm: 10.0 } };
    const signals = detectFatigueSignals(prior, current);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.kind).toBe('FREQUENCY_RISING');
    const verdict = classifyCreativeHealth(prior, current);
    expect(verdict.status).toBe('WATCH');
    expect(verdict.status).not.toBe('FATIGUE');
  });

  it('TWO independent signals yield FATIGUE', () => {
    // frequency rising AND ctr declining.
    const current: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 3.0, ctr: 1.5, cpm: 10.0 } };
    const signals = detectFatigueSignals(prior, current);
    expect(signals.map((s) => s.kind).sort()).toEqual(['CTR_DECLINING', 'FREQUENCY_RISING']);
    expect(classifyCreativeHealth(prior, current).status).toBe('FATIGUE');
  });

  it('THREE signals also FATIGUE (frequency up, ctr down, cpm up)', () => {
    const current: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 3.0, ctr: 1.5, cpm: 13.0 } };
    const verdict = classifyCreativeHealth(prior, current);
    expect(verdict.signals).toHaveLength(3);
    expect(verdict.status).toBe('FATIGUE');
  });

  it('no meaningful movement is HEALTHY', () => {
    const current: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 2.05, ctr: 1.98, cpm: 10.1 } };
    expect(detectFatigueSignals(prior, current)).toHaveLength(0);
    expect(classifyCreativeHealth(prior, current).status).toBe('HEALTHY');
  });

  it('a lone CPM rise (sub-threshold others) is still only WATCH', () => {
    const current: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 2.0, ctr: 2.0, cpm: 12.5 } };
    expect(classifyCreativeHealth(prior, current).status).toBe('WATCH');
  });

  it('findings are advisory (reviewOnly:true), never applied', () => {
    const current: CreativeWindow = { entityId: 'ad1', metrics: { frequency: 3.0, ctr: 1.5, cpm: 13.0 } };
    const v = classifyCreativeHealth(prior, current);
    expect(v.reviewOnly).toBe(true);
    expect('apply' in v).toBe(false);
  });
});
