/**
 * Coherence-2 Program 28 — AI evaluation scenarios (cross-domain golden cases as graded evals).
 *
 * Structured input facts → expected/prohibited conclusions + grounding/safety requirements. These are
 * the human-reviewable reference set a senior media buyer would sign off; they grade the WHOLE composed
 * answer (media + commerce + creative together), not isolated functions. Extend this file to grow the
 * suite; each entry is independent. (This is the deterministic-composition layer; a live model would be
 * graded by the identical rubric when BLOCKED_EXTERNAL is lifted.)
 */
import type { EvalScenario } from './harness';
import type { Diagnosis, Severity } from '../../intelligence/decision-model';
import type { CommerceDiagnosis } from '../../commerce/diagnostics';
import type { CreativeRecommendation } from '../../creative/recommendations';

const media = (type: Diagnosis['type'], severity: Severity, trust: Diagnosis['dataTrust'] = 'PLATFORM_REPORTED', factors?: Diagnosis['factors']): Diagnosis => ({
  type, scope: { organizationId: 'eval-org', accountId: 'a', entityId: 'c1', entityLevel: 'campaign' },
  severity, summary: { en: type, ar: type }, evidence: [], confidence: 'MEDIUM', dataTrust: trust, factors,
});
const commerce = (type: CommerceDiagnosis['type'], severity: CommerceDiagnosis['severity']): CommerceDiagnosis => ({ type, severity, summary: { en: type, ar: type }, evidence: {} });
const fatigue: CreativeRecommendation = { organizationId: 'eval-org', accountId: 'a', scope: { clusterId: 'cl' }, category: 'CREATIVE_FATIGUE_REVIEW', reasoning: { en: 'fatigue', ar: 'إجهاد' }, evidence: {}, confidence: 'MEDIUM', risk: 'MODERATE', dataTrust: 'PLATFORM_REPORTED', comparability: 'PARTIALLY_COMPARABLE', expectedImpact: 'NEGATIVE_RISK_REDUCTION', requiresHumanApproval: true };

export const EVAL_SCENARIOS: EvalScenario[] = [
  { id: 'S01', titleEn: 'CPM-driven CPA rise is media, not creative', input: { intent: 'PROFITABILITY_DECLINE', media: { diagnoses: [media('CPM_PRESSURE', 'ATTENTION')] } }, expect: { factorsInclude: ['MEDIA:CPM_PRESSURE'], factorsProhibit: ['CREATIVE:CREATIVE_FATIGUE_REVIEW'], nextActionOneOf: ['REVIEW'] } },
  { id: 'S02', titleEn: 'Refunds + fatigue both worsen profit; commerce ranks first via materiality', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('REFUNDS_ERODE_NET_REVENUE', 'MATERIAL')] }, creative: { recommendations: [fatigue] }, materiality: { 'COMMERCE:REFUNDS_ERODE_NET_REVENUE': 0.7 } }, expect: { factorsInclude: ['COMMERCE:REFUNDS_ERODE_NET_REVENUE', 'CREATIVE:CREATIVE_FATIGUE_REVIEW'] } },
  { id: 'S03', titleEn: 'Platform ROAS up but merchant profit down', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('REVENUE_UP_PROFIT_DOWN', 'MATERIAL'), commerce('PLATFORM_ROAS_EXCEEDS_MERCHANT', 'MATERIAL')] } }, expect: { factorsInclude: ['COMMERCE:REVENUE_UP_PROFIT_DOWN'], nextActionOneOf: ['REVIEW', 'INVESTIGATE', 'ATTENTION'] } },
  { id: 'S04', titleEn: 'Data gaps route to INVESTIGATE with a caveat', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('COMMERCE_DATA_GAPS', 'WATCH')] } }, expect: { nextActionOneOf: ['INVESTIGATE'], requireUnresolved: true } },
  { id: 'S05', titleEn: 'Insufficient evidence is a caveat, not a factor', input: { intent: 'PROFITABILITY_DECLINE', media: { diagnoses: [media('INSUFFICIENT_EVIDENCE', 'INFO')] } }, expect: { factorsProhibit: ['MEDIA:INSUFFICIENT_EVIDENCE'], requireUnresolved: true } },
  { id: 'S06', titleEn: 'Nothing connected → INSUFFICIENT_EVIDENCE, honest availability', input: { intent: 'DAILY_REVIEW', availability: { MEDIA: 'NOT_CONNECTED', COMMERCE: 'NOT_CONNECTED' } }, expect: { nextActionOneOf: ['INSUFFICIENT_EVIDENCE'] } },
  { id: 'S07', titleEn: 'Critical media escalates to ATTENTION above material commerce', input: { intent: 'DAILY_REVIEW', media: { diagnoses: [media('ROAS_DETERIORATION', 'CRITICAL')] }, commerce: { diagnoses: [commerce('MER_BELOW_TARGET', 'MATERIAL')] } }, expect: { nextActionOneOf: ['ATTENTION'], factorsInclude: ['MEDIA:ROAS_DETERIORATION'] } },
  { id: 'S08', titleEn: 'Trust is capped by the weakest source', input: { intent: 'DAILY_REVIEW', media: { diagnoses: [media('ROAS_DETERIORATION', 'ATTENTION', 'UNVERIFIED'), media('CPA_DETERIORATION', 'WATCH', 'PLATFORM_REPORTED')] } }, expect: { trustTier: 'UNVERIFIED' } },
  { id: 'S09', titleEn: 'Brand/strategic-only, no deterioration → MONITOR, no false reco', input: { intent: 'DAILY_REVIEW', media: { diagnoses: [media('SPEND_INCREASE', 'INFO')] } }, expect: { nextActionOneOf: ['MONITOR'] } },
  { id: 'S10', titleEn: 'Creative-only signal yields a CREATIVE factor', input: { intent: 'DAILY_REVIEW', creative: { recommendations: [fatigue] } }, expect: { factorsInclude: ['CREATIVE:CREATIVE_FATIGUE_REVIEW'], requireReviewOnly: true } },
  { id: 'S11', titleEn: 'Below break-even is material commerce', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('BELOW_BREAK_EVEN', 'MATERIAL')] } }, expect: { factorsInclude: ['COMMERCE:BELOW_BREAK_EVEN'], nextActionOneOf: ['REVIEW', 'ATTENTION'] } },
  { id: 'S12', titleEn: 'Material reconciliation variance → investigate attribution', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('MATERIAL_RECONCILIATION_VARIANCE', 'MATERIAL')] } }, expect: { nextActionOneOf: ['INVESTIGATE', 'REVIEW', 'ATTENTION'] } },
  { id: 'S13', titleEn: 'CPA up decomposed to click_through → still a media factor', input: { intent: 'CAMPAIGN_DIAGNOSIS', media: { diagnoses: [media('CPA_DETERIORATION', 'ATTENTION', 'PLATFORM_REPORTED', [{ factor: 'click_through', sharePct: 80 }])] } }, expect: { factorsInclude: ['MEDIA:CPA_DETERIORATION'] } },
  { id: 'S14', titleEn: 'AOV fell (watch) composes without over-escalating', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('CPA_STABLE_AOV_FELL', 'WATCH')] } }, expect: { nextActionOneOf: ['MONITOR', 'REVIEW'] } },
  { id: 'S15', titleEn: 'ROAS up / margin down is a material commerce factor', input: { intent: 'PROFITABILITY_DECLINE', commerce: { diagnoses: [commerce('ROAS_UP_MARGIN_DOWN', 'MATERIAL')] } }, expect: { factorsInclude: ['COMMERCE:ROAS_UP_MARGIN_DOWN'] } },
  { id: 'S16', titleEn: 'Multi-domain: media + commerce + creative all surface', input: { intent: 'PROFITABILITY_DECLINE', media: { diagnoses: [media('CPA_DETERIORATION', 'WATCH')] }, commerce: { diagnoses: [commerce('REFUNDS_ERODE_NET_REVENUE', 'MATERIAL')] }, creative: { recommendations: [fatigue] } }, expect: { factorsInclude: ['MEDIA:CPA_DETERIORATION', 'COMMERCE:REFUNDS_ERODE_NET_REVENUE', 'CREATIVE:CREATIVE_FATIGUE_REVIEW'], requireReviewOnly: true } },
  { id: 'S17', titleEn: 'Conversion-rate decline is a media funnel factor', input: { intent: 'CAMPAIGN_DIAGNOSIS', media: { diagnoses: [media('CONVERSION_RATE_DECLINE', 'ATTENTION')] } }, expect: { factorsInclude: ['MEDIA:CONVERSION_RATE_DECLINE'] } },
  { id: 'S18', titleEn: 'Frequency pressure composes as a media factor', input: { intent: 'CAMPAIGN_DIAGNOSIS', media: { diagnoses: [media('FREQUENCY_PRESSURE', 'WATCH')] } }, expect: { factorsInclude: ['MEDIA:FREQUENCY_PRESSURE'], nextActionOneOf: ['MONITOR', 'REVIEW'] } },
  { id: 'S19', titleEn: 'Tracking/data-quality issue routes to INVESTIGATE', input: { intent: 'ACCOUNT_DIAGNOSIS', media: { diagnoses: [media('DATA_QUALITY_ISSUE', 'ATTENTION')] } }, expect: { nextActionOneOf: ['INVESTIGATE'] } },
  { id: 'S20', titleEn: 'Mixed/weak evidence still grounds every surfaced factor', input: { intent: 'PROFITABILITY_DECLINE', media: { diagnoses: [media('CTR_DETERIORATION', 'WATCH', 'UNVERIFIED')] }, commerce: { diagnoses: [commerce('REFUNDS_ERODE_NET_REVENUE', 'WATCH')] } }, expect: { trustTier: 'UNVERIFIED', requireReviewOnly: true } },
];
