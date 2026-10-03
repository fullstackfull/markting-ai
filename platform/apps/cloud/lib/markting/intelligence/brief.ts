/**
 * Phase 2U — the media-buyer Morning Brief. A STRUCTURED answer to the seven daily questions, built
 * deterministically from AccountIntelligence. The LLM narrates this object into prose (en/ar); it
 * never invents the findings. Each section carries the evidence that backs it so the brief is
 * inspectable (Phase 2W).
 */
import { buildOpportunityCenter } from './opportunity-center';
import type { AccountIntelligence } from './analyze';
import type { BiText, EvidenceRef } from './decision-model';

export interface BriefSection { title: BiText; items: Array<{ text: BiText; evidence: EvidenceRef[] }> }
export interface MorningBrief {
  organizationId: string;
  period: AccountIntelligence['period'];
  currency?: string;
  dataset: string;
  whatChanged: BriefSection;
  why: BriefSection;
  whatMattersMost: BriefSection;
  needsAttention: BriefSection;
  opportunities: BriefSection;
  unreliableData: BriefSection;
  reviewToday: BriefSection;
  /** A compact bilingual summary line the narrator can lead with. */
  summaryLine: BiText;
}

function section(en: string, ar: string): BriefSection { return { title: { en, ar }, items: [] }; }

export function buildMorningBrief(intel: AccountIntelligence): MorningBrief {
  const oc = buildOpportunityCenter(intel);
  const brief: MorningBrief = {
    organizationId: intel.organizationId,
    period: intel.period,
    currency: intel.currency,
    dataset: intel.dataset,
    whatChanged: section('What changed', 'ما الذي تغيّر'),
    why: section('Why', 'لماذا'),
    whatMattersMost: section('What matters most', 'الأهم'),
    needsAttention: section('Needs attention', 'يحتاج انتباه'),
    opportunities: section('Opportunities', 'الفرص'),
    unreliableData: section('Unreliable data', 'بيانات غير موثوقة'),
    reviewToday: section('Review today', 'للمراجعة اليوم'),
    summaryLine: { en: '', ar: '' },
  };

  // What changed — the account-level headline metric moves.
  const accChange = intel.accountDiagnoses.filter((d) => d.scope.entityLevel === 'account' && (d.type.includes('CPA') || d.type.includes('ROAS') || d.type.includes('SPEND') || d.type.includes('CONVERSION')));
  for (const d of accChange.slice(0, 4)) brief.whatChanged.items.push({ text: d.summary, evidence: d.evidence });

  // Why — diagnoses that carry a factor decomposition (the causal structure, arithmetic-backed).
  for (const d of [...intel.accountDiagnoses, ...intel.campaigns.flatMap((c) => c.diagnoses)].filter((d) => d.factors && d.factors.length).slice(0, 4)) {
    brief.why.items.push({ text: d.summary, evidence: d.evidence });
  }

  // What matters most — top materiality attention items.
  for (const a of oc.needsAttention.slice(0, 3)) brief.whatMattersMost.items.push({ text: a.headline, evidence: [] });

  for (const a of oc.needsAttention) brief.needsAttention.items.push({ text: a.headline, evidence: [] });
  for (const o of oc.opportunities.slice(0, 5)) brief.opportunities.items.push({ text: o.headline, evidence: [] });
  for (const di of oc.dataIssues) brief.unreliableData.items.push({ text: di.headline, evidence: [] });
  for (const r of oc.recommendations.slice(0, 5)) brief.reviewToday.items.push({ text: r.reasoning, evidence: r.evidence });

  const attn = oc.needsAttention.length;
  const opp = oc.opportunities.length;
  const issues = oc.dataIssues.length;
  brief.summaryLine = {
    en: `${attn} item(s) need attention, ${opp} opportunit(ies), ${issues} data issue(s). Dataset: ${intel.dataset}${intel.mixedCurrency ? ' (mixed currency — some comparisons withheld)' : ''}.`,
    ar: `${attn} عنصر يحتاج انتباه، ${opp} فرصة، ${issues} مشكلة بيانات. مجموعة البيانات: ${intel.dataset}${intel.mixedCurrency ? ' (عملات مختلطة — حُجبت بعض المقارنات)' : ''}.`,
  };
  return brief;
}
