/**
 * Phase 4M — safe creative deduplication. Creatives may appear under different ids; we relate them
 * without MERGING distinct creatives. Crucially, two creatives are NEVER merged solely because their
 * copy is similar — similar text with different media is RELATED, not a duplicate.
 */
import { createHash } from 'node:crypto';
import type { Creative } from './model';

export type DedupRelation = 'EXACT_DUPLICATE' | 'LIKELY_VARIANT' | 'RELATED' | 'DISTINCT';

/** Normalize text (lowercase, collapse whitespace, strip punctuation) then hash — for text similarity. */
export function normalizedTextHash(text: string): string {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}
export function contentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function firstMediaHash(c: Creative): string | undefined {
  return c.assets.find((a) => a.contentHash)?.contentHash;
}
function textCorpus(c: Creative): string {
  const t = c.text;
  return [t?.headline, t?.primaryText, t?.description, t?.cta].filter(Boolean).join(' ');
}
/** Jaccard over word sets — a transparent similarity, not an opaque embedding. */
function textSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / (wa.size + wb.size - inter);
}

/** Classify the relation between two creatives. */
export function relationBetween(a: Creative, b: Creative): { relation: DedupRelation; reasons: string[] } {
  const reasons: string[] = [];
  const mhA = firstMediaHash(a), mhB = firstMediaHash(b);
  const sameMedia = !!mhA && mhA === mhB;
  const tA = textCorpus(a), tB = textCorpus(b);
  const sameText = tA && tB && normalizedTextHash(tA) === normalizedTextHash(tB);
  const sim = textSimilarity(tA, tB);

  // EXACT: identical media AND identical normalized text.
  if (sameMedia && sameText) { reasons.push('identical media hash + identical normalized text'); return { relation: 'EXACT_DUPLICATE', reasons }; }
  // LIKELY_VARIANT: same media, different copy (a copy test of the same asset), or same text + same account/campaign + same media type.
  if (sameMedia) { reasons.push('same media asset, different copy'); return { relation: 'LIKELY_VARIANT', reasons }; }
  if (sameText && a.accountId === b.accountId && a.mediaType === b.mediaType) { reasons.push('same normalized text, same account + media type'); return { relation: 'LIKELY_VARIANT', reasons }; }
  // RELATED: similar copy but DIFFERENT media — never merged into a duplicate.
  if (sim >= 0.6) { reasons.push(`similar copy (jaccard ${sim.toFixed(2)}) but different media — related, not duplicate`); return { relation: 'RELATED', reasons }; }
  reasons.push('no strong media/text relation');
  return { relation: 'DISTINCT', reasons };
}

/** Group creatives into dedup sets without merging DISTINCT/RELATED ones. Returns duplicate/variant sets. */
export function dedupGroups(creatives: Creative[]): Array<{ representative: string; members: string[]; relation: DedupRelation }> {
  const groups: Array<{ representative: string; members: string[]; relation: DedupRelation }> = [];
  const assigned = new Set<string>();
  for (let i = 0; i < creatives.length; i++) {
    const a = creatives[i]!;
    if (assigned.has(a.id)) continue;
    const members = [a.id];
    for (let j = i + 1; j < creatives.length; j++) {
      const b = creatives[j]!;
      if (assigned.has(b.id)) continue;
      const { relation } = relationBetween(a, b);
      if (relation === 'EXACT_DUPLICATE' || relation === 'LIKELY_VARIANT') { members.push(b.id); assigned.add(b.id); }
    }
    if (members.length > 1) { assigned.add(a.id); groups.push({ representative: a.id, members, relation: 'LIKELY_VARIANT' }); }
  }
  return groups;
}
