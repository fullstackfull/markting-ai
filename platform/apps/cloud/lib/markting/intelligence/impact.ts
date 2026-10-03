/**
 * Phase 2S — expected impact DIRECTION only. No fabricated "+23% ROAS". The system states the expected
 * direction of a reviewed action (or that it is uncertain / not estimated); a quantitative range would
 * require a deterministic calibrated basis the system does not yet have, so it is never produced.
 */
import type { DiagnosisType, ExpectedImpact, ReviewActionType } from './decision-model';

/**
 * Map a (diagnosis, action) pair to an expected-impact direction. Corrective reviews of a
 * deterioration reduce downside risk; reviews of an improvement/opportunity expect upside; pure
 * investigations are uncertain until the cause is found.
 */
export function expectedImpactFor(diagnosisType: DiagnosisType, actionType: ReviewActionType): ExpectedImpact {
  if (actionType === 'NO_ACTION') return 'NOT_ESTIMATED';
  if (actionType === 'INVESTIGATE_ANOMALY' || actionType === 'INVESTIGATE_DATA_QUALITY' || actionType === 'REVIEW_TRACKING') {
    return 'UNCERTAIN'; // an investigation's impact depends on what it uncovers
  }
  switch (diagnosisType) {
    case 'CPA_DETERIORATION':
    case 'ROAS_DETERIORATION':
    case 'CTR_DETERIORATION':
    case 'CPM_PRESSURE':
    case 'CPC_PRESSURE':
    case 'CONVERSION_RATE_DECLINE':
    case 'CONVERSION_VOLUME_DECLINE':
    case 'FUNNEL_STAGE_COLLAPSE':
    case 'OVERSPEND_VS_PACING':
    case 'FREQUENCY_PRESSURE':
      return 'NEGATIVE_RISK_REDUCTION'; // acting is expected to reduce a worsening/overspend
    case 'CPA_IMPROVEMENT':
    case 'ROAS_IMPROVEMENT':
    case 'CONVERSION_VOLUME_INCREASE':
    case 'TARGET_BEAT':
      return 'POSITIVE_DIRECTION_EXPECTED'; // reviewing a winner for scale expects upside
    default:
      return 'UNCERTAIN';
  }
}
