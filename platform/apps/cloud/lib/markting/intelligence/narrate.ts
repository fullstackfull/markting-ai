/**
 * Deterministic bilingual narrator. The LLM, when available through the gateway, re-narrates the
 * structured intelligence; when it is not (demo/scripted, or no model configured), this produces the
 * SAME answer locally from the structured object. Either way the FACTS come from the deterministic
 * engines — the narrator only arranges them into prose and always cites the underlying evidence. It
 * never introduces a number or claim that is not already in the structured intelligence.
 */
import type { AccountIntelligence } from './analyze';
import { buildMorningBrief } from './brief';
import type { EvidenceRef } from './decision-model';

export type Locale = 'en' | 'ar';

export interface NarratedAnswer {
  locale: Locale;
  text: string;
  /** The evidence the narration rests on (so the answer is inspectable, Phase 2W). */
  evidence: EvidenceRef[];
  /** True when produced locally (no live model); the caller records this as local_fallback. */
  local: boolean;
}

function line(locale: Locale, en: string, ar: string): string { return locale === 'ar' ? ar : en; }

/** Narrate the morning brief deterministically. */
export function narrateBrief(intel: AccountIntelligence, locale: Locale): NarratedAnswer {
  const brief = buildMorningBrief(intel);
  const evidence: EvidenceRef[] = [];
  const parts: string[] = [brief.summaryLine[locale]];
  const sections = [brief.whatChanged, brief.why, brief.whatMattersMost, brief.needsAttention, brief.opportunities, brief.unreliableData, brief.reviewToday];
  for (const s of sections) {
    if (s.items.length === 0) continue;
    parts.push(`\n${s.title[locale]}:`);
    for (const it of s.items) { parts.push(`• ${it.text[locale]}`); evidence.push(...it.evidence); }
  }
  if (intel.dataset !== 'LIVE') parts.push(line(locale, `\n(Dataset: ${intel.dataset} — not live account data.)`, `\n(مجموعة البيانات: ${intel.dataset} — ليست بيانات حساب مباشر.)`));
  return { locale, text: parts.join('\n'), evidence, local: true };
}
