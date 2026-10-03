/**
 * Phase 6H — DETERMINISTIC decision simulator. For a proposed budget/allocation change it projects
 * CURRENT vs SCENARIO_A/B/C. Every output value is TAGGED by provenance — OBSERVED (measured), ASSUMED
 * (a stated assumption), PROJECTED (derived from a valid response model within range), or UNKNOWN.
 * Projections are NEVER presented as guarantees; outside a response curve's validity range the result
 * is UNKNOWN, not an extrapolation. The LLM does no hidden math — this is reproducible arithmetic.
 */
import type { ResponseCurve } from './response-curve';
import { withinValidity } from './response-curve';

export type ValueProvenance = 'OBSERVED' | 'ASSUMED' | 'PROJECTED' | 'UNKNOWN';
export interface TaggedValue { value?: number; provenance: ValueProvenance; note?: string }

export interface ScenarioInput {
  label: 'CURRENT' | 'SCENARIO_A' | 'SCENARIO_B' | 'SCENARIO_C';
  spendMinor: number;
  currency: string;
}

export interface ScenarioResult {
  label: ScenarioInput['label'];
  spend: TaggedValue;
  conversions: TaggedValue;
  cpa: TaggedValue;
  revenue: TaggedValue;
  roas: TaggedValue;
  currency: string;
}

export interface SimulationBaseline {
  spendMinor: number;
  conversions?: number;       // OBSERVED
  cpaMinor?: number;          // OBSERVED
  revenueMinor?: number;      // OBSERVED
  roas?: number;              // OBSERVED
  currency: string;
  /** A fitted response curve, used to PROJECT conversions at a new spend within its validity range. */
  responseCurve?: ResponseCurve;
}

const obs = (v?: number): TaggedValue => (v != null ? { value: v, provenance: 'OBSERVED' } : { provenance: 'UNKNOWN' });

function projectScenario(label: ScenarioInput['label'], spendMinor: number, currency: string, base: SimulationBaseline): ScenarioResult {
  if (label === 'CURRENT' || spendMinor === base.spendMinor) {
    return { label, spend: { value: base.spendMinor, provenance: 'OBSERVED' }, conversions: obs(base.conversions), cpa: obs(base.cpaMinor), revenue: obs(base.revenueMinor), roas: obs(base.roas), currency };
  }
  const curve = base.responseCurve;
  // Project conversions from the curve ONLY within its validity range; otherwise UNKNOWN (no extrapolation).
  if (curve && curve.form !== 'INSUFFICIENT_EVIDENCE' && curve.marginalConversionsPerMinor != null && withinValidity(curve, spendMinor) && base.conversions != null) {
    const dConv = (spendMinor - base.spendMinor) * curve.marginalConversionsPerMinor;
    const projConv = Math.max(0, base.conversions + dConv);
    const cpa = projConv > 0 ? spendMinor / projConv : undefined;
    // Revenue/ROAS are only projected if we can hold AOV constant as an EXPLICIT assumption.
    const aov = base.revenueMinor != null && base.conversions ? base.revenueMinor / base.conversions : undefined;
    const projRev = aov != null ? projConv * aov : undefined;
    return {
      label, currency,
      spend: { value: spendMinor, provenance: 'ASSUMED', note: 'proposed spend' },
      conversions: { value: Math.round(projConv), provenance: 'PROJECTED', note: 'within response-curve validity range' },
      cpa: cpa != null ? { value: Math.round(cpa), provenance: 'PROJECTED' } : { provenance: 'UNKNOWN' },
      revenue: projRev != null ? { value: Math.round(projRev), provenance: 'PROJECTED', note: 'assumes constant AOV' } : { provenance: 'UNKNOWN' },
      roas: projRev != null && spendMinor > 0 ? { value: Math.round((projRev / spendMinor) * 100) / 100, provenance: 'PROJECTED', note: 'assumes constant AOV' } : { provenance: 'UNKNOWN' },
    };
  }
  // No valid projection path → spend is ASSUMED, outcomes UNKNOWN (never guessed).
  return {
    label, currency,
    spend: { value: spendMinor, provenance: 'ASSUMED', note: 'proposed spend' },
    conversions: { provenance: 'UNKNOWN', note: curve ? 'outside response-curve validity range — not projected' : 'no response curve — not projected' },
    cpa: { provenance: 'UNKNOWN' }, revenue: { provenance: 'UNKNOWN' }, roas: { provenance: 'UNKNOWN' },
  };
}

export function simulateScenarios(base: SimulationBaseline, scenarios: ScenarioInput[]): ScenarioResult[] {
  return [projectScenario('CURRENT', base.spendMinor, base.currency, base), ...scenarios.filter((s) => s.label !== 'CURRENT').map((s) => projectScenario(s.label, s.spendMinor, s.currency, base))];
}
