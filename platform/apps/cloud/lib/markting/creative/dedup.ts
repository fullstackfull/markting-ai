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
  // LIKELY_VARIANT: the ONLY merge path is a CONFIRMED same media asset with different copy (a copy
  // test of one asset). We NEVER promote to a variant on copy alone: without a matching media hash we
  // cannot prove the media is the same, so two different images that happen to share copy must not be
  // merged. (This is the Phase-4 rule: distinct creatives are never merged solely because copy matches.)
  if (sameMedia) { reasons.push('same media asset, different copy'); return { relation: 'LIKELY_VARIANT', reasons }; }
  // Media differs or is unconfirmed → at most RELATED, never merged.
  if (sameText) { reasons.push('identical copy but media not confirmed identical — related, not merged'); return { relation: 'RELATED', reasons }; }
  if (sim >= 0.6) { reasons.push(`similar copy (jaccard ${sim.toFixed(2)}) but different media — related, not duplicate`); return { relation: 'RELATED', reasons }; }
  reasons.push('no strong media/text relation');
  return { relation: 'DISTINCT', reasons };
}

/**
 * Group creatives into dedup sets without merging DISTINCT/RELATED ones. The only merge key is a shared
 * MEDIA content hash (EXACT = same media + same copy; LIKELY_VARIANT = same media, different copy), so
 * grouping is a single pass bucketing by media hash — O(N), not the old O(N²) pairwise scan. Creatives
 * with no media hash are never grouped (media identity cannot be confirmed).
 */
export function dedupGroups(creatives: Creative[]): Array<{ representative: string; members: string[]; relation: DedupRelation }> {
  const buckets = new Map<string, Creative[]>();
  for (const c of creatives) {
    const mh = firstMediaHash(c);
    if (!mh) continue; // no confirmable media identity → never merged
    (buckets.get(mh) ?? buckets.set(mh, []).get(mh)!).push(c);
  }
  const groups: Array<{ representative: string; members: string[]; relation: DedupRelation }> = [];
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    const textHashes = new Set(items.map((c) => { const t = textCorpus(c); return t ? normalizedTextHash(t) : ''; }));
    const relation: DedupRelation = textHashes.size === 1 ? 'EXACT_DUPLICATE' : 'LIKELY_VARIANT';
    groups.push({ representative: items[0]!.id, members: items.map((c) => c.id), relation });
  }
  return groups;
}
