/**
 * Phase 3I/3J — the tenant playbook and recommendation personalization. The playbook can CONSTRAIN and
 * reshape AI suggestions (phrasing, staging, protected entities); it can NEVER override Phase-0 system
 * safety. Order of authority: system safety > organization policy > AI suggestion. Personalization
 * adjusts how a recommendation is phrased/emphasized — it NEVER strengthens weak evidence, raises
 * confidence, or changes risk/status just because the organization likes aggressive growth.
 */
import { z } from 'zod';
import { RECOMMENDATION_CATEGORIES, type BiText, type Recommendation, type RecommendationCategory } from './intelligence/decision-model';

export const playbookSchema = z.object({
  budgetChangePolicy: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  riskTolerance: z.enum(['low', 'medium', 'high']).optional(),
  scalingPreference: z.enum(['staged', 'standard']).optional(),
  protectedAccounts: z.array(z.string()).max(1000).optional(),
  protectedCampaigns: z.array(z.string()).max(5000).optional(),
  allowedRecommendationCategories: z.array(z.enum(RECOMMENDATION_CATEGORIES)).optional(),
  approvalPreferences: z.object({ autoApprovalThreshold: z.number().nonnegative().optional() }).strict().optional(),
  reportingPreferences: z.object({ locale: z.enum(['ar', 'en']).optional(), currency: z.string().optional() }).strict().optional(),
}).strict();
export type PlaybookPolicy = z.infer<typeof playbookSchema>;

export const EMPTY_PLAYBOOK: PlaybookPolicy = {};

export function parsePlaybook(raw: unknown): PlaybookPolicy {
  return playbookSchema.parse(raw ?? {});
}

/** Categories the playbook always allows regardless of `allowedRecommendationCategories` — safety and
 *  data-quality reviews are never suppressed by an organization preference. */
const NEVER_SUPPRESSED: ReadonlySet<RecommendationCategory> = new Set(['TRACKING_REVIEW', 'DATA_QUALITY_REVIEW', 'ANOMALY_REVIEW']);

export interface PersonalizationNote { kind: 'staged_scaling' | 'protected_entity' | 'category_not_preferred'; note: BiText }

export interface PersonalizedRecommendation {
  recommendation: Recommendation;
  notes: PersonalizationNote[];
  /** True when the playbook would de-emphasize this (not preferred), but it is NEVER removed if it is
   *  a safety/data-quality review or carries a non-LOW risk the human should still see. */
  deEmphasized: boolean;
}

/**
 * Personalize a recommendation against the playbook. Pure. Confidence, risk, status, evidence and the
 * dataTrust are returned UNCHANGED — only phrasing notes and a de-emphasis flag are added.
 */
export function personalizeRecommendation(rec: Recommendation, playbook: PlaybookPolicy): PersonalizedRecommendation {
  const notes: PersonalizationNote[] = [];

  // Conservative / staged scaling: reshape the PHRASING of a scale review, not its evidence.
  if (rec.actionType === 'REVIEW_BUDGET_SCALE' && (playbook.budgetChangePolicy === 'conservative' || playbook.scalingPreference === 'staged')) {
    notes.push({ kind: 'staged_scaling', note: { en: 'Per your conservative scaling preference: review a smaller staged increase rather than an aggressive one.', ar: 'وفقًا لتفضيلك التوسيع المتحفّظ: راجع زيادة صغيرة مُتدرّجة بدلًا من زيادة كبيرة.' } });
  }

  // Protected accounts/campaigns: flag for extra human scrutiny; never auto-suppress.
  const protectedHit = (playbook.protectedAccounts?.includes(rec.accountId)) || (playbook.protectedCampaigns?.includes(rec.entityScope.entityId));
  if (protectedHit && (rec.actionType === 'REVIEW_PAUSE' || rec.actionType === 'REVIEW_BUDGET_SCALE' || rec.actionType === 'REVIEW_BUDGET_REDUCE')) {
    notes.push({ kind: 'protected_entity', note: { en: 'This entity is marked PROTECTED — any change needs explicit senior review.', ar: 'هذا الكيان مُعلّم كمحمي — أي تغيير يتطلب مراجعة عليا صريحة.' } });
  }

  // Category not in the org's preferred set → de-emphasize, unless it is a safety/data-quality review.
  let deEmphasized = false;
  if (playbook.allowedRecommendationCategories && !playbook.allowedRecommendationCategories.includes(rec.category) && !NEVER_SUPPRESSED.has(rec.category)) {
    deEmphasized = true;
    notes.push({ kind: 'category_not_preferred', note: { en: `${rec.category} is outside your configured preferred categories — shown for awareness, lower priority.`, ar: `${rec.category} خارج فئاتك المفضّلة المُهيّأة — يُعرض للعلم بأولوية أقل.` } });
  }

  // IMPORTANT: rec is returned with confidence/risk/status/evidence UNCHANGED.
  return { recommendation: rec, notes, deEmphasized };
}

/** The playbook can never make something auto-approvable below Phase-0 rules; this is advisory only. */
export function autoApprovalThreshold(playbook: PlaybookPolicy): number | undefined {
  return playbook.approvalPreferences?.autoApprovalThreshold;
}
