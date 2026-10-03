/**
 * Coherence Program 27 — honest demo + empty data sources for the orchestrator.
 *
 * `demoGatherer` produces a deterministic, CLEARLY SYNTHETIC cross-domain scenario (a profitability
 * decline explained by refunds + a campaign inefficiency + a fatiguing creative) so the workspace and
 * assistant are demonstrable without any live credentials. All of its trust tiers are SYNTHETIC, so the
 * composed result's trust summary reads non-live and the source-guard keeps it out of a live surface.
 *
 * `emptyGatherer` is the honest live-without-connections source: it reports each domain NOT_CONNECTED /
 * BLOCKED_EXTERNAL and contributes no fabricated signal, so a live deployment with nothing connected
 * shows a truthful empty state rather than demo content.
 */
import type { IntelligenceGatherer, GatheredIntelligence } from './assistant-service';
import type { Diagnosis } from '../intelligence/decision-model';
import type { CommerceDiagnosis, CommerceRecommendation } from '../commerce/diagnostics';
import type { CreativeRecommendation } from '../creative/recommendations';
import { sectionForIntent } from './sections';
import { seedClientForAccount, SEED_PORTFOLIO } from './seed';

export const emptyGatherer: IntelligenceGatherer = {
  async gather() {
    return {
      availability: {
        MEDIA: 'NOT_CONNECTED', COMMERCE: 'NOT_CONNECTED', CREATIVE: 'NOT_CONNECTED',
        HISTORY: 'NO_SIGNAL', MEMORY: 'NO_SIGNAL', EXPERIMENTS: 'NOT_CONNECTED',
      },
    } satisfies GatheredIntelligence;
  },
};

export const demoGatherer: IntelligenceGatherer = {
  sections(context, intent) {
    return sectionForIntent(intent, seedClientForAccount(context.accountId).account, SEED_PORTFOLIO);
  },
  async gather(context) {
    const org = context.organizationId;
    const accountId = context.accountId ?? 'sandbox:acc:1';
    const campaignId = `${accountId}:camp:ramadan`;

    const mediaDiagnoses: Diagnosis[] = [
      {
        type: 'CPA_DETERIORATION',
        scope: { organizationId: org, accountId, entityId: campaignId, entityLevel: 'campaign' },
        severity: 'WATCH',
        summary: { en: 'CPA deteriorated on "Ramadan Awareness - KSA" (largest-spend campaign).', ar: 'تدهور CPA في حملة "التوعية برمضان - السعودية" (الأعلى إنفاقًا).' },
        evidence: [], confidence: 'MEDIUM', dataTrust: 'SYNTHETIC',
        factors: [{ factor: 'click_through', sharePct: 60 }, { factor: 'media_cost', sharePct: 40 }],
      },
    ];
    const commerceDiagnoses: CommerceDiagnosis[] = [
      { type: 'REFUNDS_ERODE_NET_REVENUE', severity: 'MATERIAL', summary: { en: 'Refunds are 22% of gross — net revenue is well below platform-reported purchase value.', ar: 'الاستردادات 22% من الإجمالي — صافي الإيراد أقل بكثير من قيمة الشراء المُبلّغة من المنصّة.' }, evidence: { refundRateByValue: 0.22 } },
      { type: 'REVENUE_UP_PROFIT_DOWN', severity: 'MATERIAL', summary: { en: 'Revenue rose but contribution profit fell — growth is unprofitable at the current cost structure.', ar: 'ارتفع الإيراد لكن انخفض ربح المساهمة — النمو غير مربح ضمن هيكل التكلفة الحالي.' }, evidence: { netNow: 480000, netPrev: 500000 } },
    ];
    const creativeRecs: CreativeRecommendation[] = [
      { organizationId: org, accountId, scope: { clusterId: 'cl-ramadan-hooks', campaignId }, category: 'CREATIVE_FATIGUE_REVIEW', reasoning: { en: 'Fatigue signal on the dominant creative cluster in the largest-spend campaign — consider a refresh test.', ar: 'إشارة إجهاد في العنقود الإبداعي المهيمن ضمن الحملة الأعلى إنفاقًا — فكّر في اختبار تجديد.' }, evidence: { signals: ['ctr_decline', 'frequency_rise'] }, confidence: 'MEDIUM', risk: 'MODERATE', dataTrust: 'SYNTHETIC', comparability: 'PARTIALLY_COMPARABLE', expectedImpact: 'NEGATIVE_RISK_REDUCTION', requiresHumanApproval: true },
    ];
    const commerceRecs: CommerceRecommendation[] = [
      { organizationId: org, scope: { accountId }, category: 'REFUND_RATE_REVIEW', reasoning: { en: 'Review high-refund products before scoring campaigns on gross purchase value.', ar: 'راجع المنتجات عالية الاسترداد قبل تقييم الحملات بقيمة الشراء الإجمالية.' }, evidence: { refundRateByValue: 0.22 }, confidence: 'MEDIUM', risk: 'HIGH', dataTrust: 'RECONCILED', requiresHumanApproval: true },
      { organizationId: org, scope: { accountId }, category: 'PROFITABILITY_REVIEW', reasoning: { en: 'Review spend against contribution profit, not platform ROAS.', ar: 'راجع الإنفاق مقابل ربح المساهمة وليس ROAS المنصّة.' }, evidence: {}, confidence: 'MEDIUM', risk: 'HIGH', dataTrust: 'RECONCILED', requiresHumanApproval: true },
    ];

    return {
      media: { diagnoses: mediaDiagnoses },
      commerce: { diagnoses: commerceDiagnoses, recommendations: commerceRecs },
      creative: { recommendations: creativeRecs },
      history: { priorOutcomeSummary: { en: 'A prior budget-reduction recommendation on this campaign was ALIGNED_WITH_RECOMMENDATION (synthetic history).', ar: 'توصية سابقة بخفض الميزانية لهذه الحملة كانت متوافقة مع التوصية (سجل تجريبي).' } },
      materiality: { 'COMMERCE:REFUNDS_ERODE_NET_REVENUE': 0.6, 'COMMERCE:REVENUE_UP_PROFIT_DOWN': 0.3, 'MEDIA:CPA_DETERIORATION': 0.1 },
      availability: { MEMORY: 'NO_SIGNAL', EXPERIMENTS: 'NO_SIGNAL' },
    } satisfies GatheredIntelligence;
  },
};
