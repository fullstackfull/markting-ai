/**
 * Phase 4E — creative fatigue engine. Fatigue is NEVER claimed from one metric. It requires several
 * corroborating signals (rising frequency, falling CTR, rising CPC, declining CVR/ROAS, stable/rising
 * CPM ruling out an auction-wide cause, age/saturation, declining delivery efficiency). Output is a
 * SIGNAL with confidence and the contributing evidence — never "PROVEN FATIGUE" (that needs an
 * experiment, which Phase 4 does not run). Thin data → INSUFFICIENT_EVIDENCE.
 */
import { MIN_SAMPLE_FOR_CONFIDENCE, type DataTier } from '../data-trust';
import type { BiText } from '../intelligence/decision-model';

export type FatigueState = 'NO_SIGNAL' | 'WATCH' | 'FATIGUE_SIGNAL' | 'STRONG_FATIGUE_SIGNAL' | 'INSUFFICIENT_EVIDENCE';

export interface FatigueInput {
  dataTrust: DataTier;
  /** Current vs baseline window values (same currency). */
  frequency?: { from?: number; to?: number };
  ctr?: { from: number; to: number };
  cpc?: { from: number; to: number };
  cvr?: { from: number; to: number };
  roas?: { from: number; to: number };
  cpm?: { from: number; to: number };
  conversions?: number;      // sample behind the ratios (current window)
  impressions?: number;
  ageDays?: number;
  windowComplete?: boolean;
  /** Minimum impressions before any read. */
  minImpressions?: number;
  materialPct?: number;
}

export interface FatigueSignal { kind: string; present: boolean; detail: string }
export interface FatigueResult { state: FatigueState; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; signals: FatigueSignal[]; reasons: string[]; label: BiText }

function pct(from?: number, to?: number): number | undefined {
  if (from == null || to == null || from === 0) return undefined;
  return ((to - from) / Math.abs(from)) * 100;
}

export function assessFatigue(input: FatigueInput): FatigueResult {
  const material = input.materialPct ?? 10;
  const minImp = input.minImpressions ?? 1000;
  const reasons: string[] = [];
  if (input.dataTrust === 'SYNTHETIC' || input.dataTrust === 'UNVERIFIED') reasons.push('data tier too low');
  if ((input.impressions ?? 0) < minImp) reasons.push(`under ${minImp} impressions`);
  if (input.windowComplete === false) reasons.push('window still open');
  if ((input.conversions ?? 0) < MIN_SAMPLE_FOR_CONFIDENCE && (input.roas || input.cvr)) reasons.push('thin conversion sample for ratio signals');
  if (reasons.length) return { state: 'INSUFFICIENT_EVIDENCE', confidence: 'LOW', signals: [], reasons, label: LBL.INSUFFICIENT_EVIDENCE };

  const signals: FatigueSignal[] = [];
  const add = (kind: string, present: boolean, detail: string) => signals.push({ kind, present, detail });
  const freqUp = pct(input.frequency?.from, input.frequency?.to);
  const ctrP = pct(input.ctr?.from, input.ctr?.to);
  const cpcP = pct(input.cpc?.from, input.cpc?.to);
  const cvrP = pct(input.cvr?.from, input.cvr?.to);
  const roasP = pct(input.roas?.from, input.roas?.to);
  const cpmP = pct(input.cpm?.from, input.cpm?.to);

  add('rising_frequency', (freqUp ?? 0) >= material || (input.frequency?.to ?? 0) >= 3.5, `frequency ${input.frequency?.from ?? '?'}→${input.frequency?.to ?? '?'}`);
  add('falling_ctr', (ctrP ?? 0) <= -material, `CTR ${ctrP == null ? '?' : Math.round(ctrP)}%`);
  add('rising_cpc', (cpcP ?? 0) >= material, `CPC ${cpcP == null ? '?' : Math.round(cpcP)}%`);
  add('declining_cvr', (cvrP ?? 0) <= -material, `CVR ${cvrP == null ? '?' : Math.round(cvrP)}%`);
  add('declining_roas', (roasP ?? 0) <= -material, `ROAS ${roasP == null ? '?' : Math.round(roasP)}%`);
  // CPM stable/rising RULES OUT an auction-wide cheap-impression explanation for the CTR/CPC move.
  add('cpm_not_falling', (cpmP ?? 0) >= -material, `CPM ${cpmP == null ? '?' : Math.round(cpmP)}%`);
  add('aged', (input.ageDays ?? 0) >= 21, `age ${input.ageDays ?? '?'}d`);

  const present = signals.filter((s) => s.present).map((s) => s.kind);
  const core = ['rising_frequency', 'falling_ctr'].every((k) => present.includes(k));
  const corroborated = present.filter((k) => ['declining_cvr', 'declining_roas', 'rising_cpc'].includes(k)).length;
  const cpmOk = present.includes('cpm_not_falling');

  let state: FatigueState;
  let confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  if (core && cpmOk && corroborated >= 1) { state = 'STRONG_FATIGUE_SIGNAL'; confidence = corroborated >= 2 ? 'HIGH' : 'MEDIUM'; }
  else if ((core || (present.includes('falling_ctr') && present.includes('rising_frequency'))) || (present.includes('falling_ctr') && corroborated >= 1)) { state = 'FATIGUE_SIGNAL'; confidence = 'MEDIUM'; }
  else if (present.includes('falling_ctr') || present.includes('rising_frequency')) { state = 'WATCH'; confidence = 'LOW'; }
  else { state = 'NO_SIGNAL'; confidence = 'LOW'; }

  reasons.push(`signals present: ${present.join(', ') || 'none'}`);
  if (state !== 'NO_SIGNAL' && !cpmOk) reasons.push('CPM fell — CTR/CPC move may be auction-driven, not fatigue (downgraded)');
  return { state, confidence, signals, reasons, label: LBL[state] };
}

const LBL: Record<FatigueState, BiText> = {
  NO_SIGNAL: { en: 'No fatigue signal', ar: 'لا إشارة إجهاد' },
  WATCH: { en: 'Watch', ar: 'مراقبة' },
  FATIGUE_SIGNAL: { en: 'Fatigue signal (not proven)', ar: 'إشارة إجهاد (غير مثبتة)' },
  STRONG_FATIGUE_SIGNAL: { en: 'Strong fatigue signal (not proven)', ar: 'إشارة إجهاد قوية (غير مثبتة)' },
  INSUFFICIENT_EVIDENCE: { en: 'Insufficient evidence', ar: 'أدلة غير كافية' },
};
