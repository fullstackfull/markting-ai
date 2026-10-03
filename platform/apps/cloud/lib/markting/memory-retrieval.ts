/**
 * Phase 3G — bounded, relevant memory retrieval. The AI must NOT receive the whole organizational
 * history in every prompt. This scores active memory items for relevance to the current context
 * (account / provider / entity / recommendation category / recency / trust) and returns a bounded,
 * token-capped selection. Pure — the caller fetches active items from the store and passes them here.
 */
import { isActive, TRUST_RANK, type MemoryItem } from './memory';

export interface RetrievalContext {
  accountId?: string;
  provider?: string;
  entityId?: string;
  category?: string; // recommendation category in play
  now?: number;
}

export interface RetrievalBudget { maxItems: number; maxChars: number }
export const DEFAULT_RETRIEVAL_BUDGET: RetrievalBudget = { maxItems: 12, maxChars: 4000 };

function relevanceScore(item: MemoryItem, ctx: RetrievalContext, now: number): number {
  let score = TRUST_RANK[item.trust] * 2; // trustworthy memory first
  const v = JSON.stringify(item.value ?? '');
  const ref = item.sourceReference ?? '';
  if (ctx.accountId && (v.includes(ctx.accountId) || ref.includes(ctx.accountId) || item.key.includes(ctx.accountId))) score += 4;
  if (ctx.entityId && (v.includes(ctx.entityId) || ref.includes(ctx.entityId) || item.key.includes(ctx.entityId))) score += 4;
  if (ctx.provider && (v.includes(ctx.provider) || item.key.includes(ctx.provider))) score += 2;
  if (ctx.category && (v.toUpperCase().includes(ctx.category) || item.key.toUpperCase().includes(ctx.category))) score += 2;
  // Explicit facts / human preferences are broadly relevant (targets, protected accounts, etc.).
  if (item.category === 'explicit_fact' || item.category === 'human_preference') score += 3;
  // Recency: decay older derived/operational memory (explicit human items do not decay here).
  if (item.category === 'operational_context' || item.category === 'historical_outcome' || item.category === 'historical_decision') {
    const ageDays = (now - Date.parse(item.lastVerifiedAt ?? item.createdAt)) / 86_400_000;
    score -= Math.min(5, ageDays / 14);
  }
  return score;
}

export interface RetrievedMemory { items: MemoryItem[]; truncatedCount: number }

/** Select the most relevant ACTIVE memory within the budget. Revoked/stale/expired are excluded. */
export function retrieveMemory(all: MemoryItem[], ctx: RetrievalContext, budget: RetrievalBudget = DEFAULT_RETRIEVAL_BUDGET): RetrievedMemory {
  const now = ctx.now ?? Date.now();
  const active = all.filter((i) => isActive(i, now));
  const ranked = active
    .map((i) => ({ i, s: relevanceScore(i, ctx, now) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  const items: MemoryItem[] = [];
  let chars = 0;
  for (const it of ranked) {
    if (items.length >= budget.maxItems) break;
    const size = JSON.stringify({ k: it.key, v: it.value }).length;
    if (chars + size > budget.maxChars) break;
    items.push(it);
    chars += size;
  }
  return { items, truncatedCount: Math.max(0, active.length - items.length) };
}
