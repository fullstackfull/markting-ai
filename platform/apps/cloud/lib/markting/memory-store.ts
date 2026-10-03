import 'server-only';
import { db } from '@/lib/db';
import {
  evaluateWritePolicy, isActive, memoryWriteSchema,
  type MemoryCategory, type MemoryItem, type MemoryTrust, type MemoryWriteRequest,
} from './memory';

/**
 * Phase 3E/3F — tenant-scoped Marketing Memory store. Every write goes through the deterministic
 * policy in memory.ts (the LLM never writes memory directly). Memory is correctable/forgettable
 * business state, kept separate from immutable audit history (audit_events/pending_operations).
 */

/**
 * Write memory. The organization is SERVER-DERIVED (first arg from the authenticated principal) and
 * always overrides any organizationId in the payload — a client/model-supplied org is rejected, so a
 * forwarded request body can never write into another tenant (defense-in-depth, PARTIAL-2 fix).
 */
export async function writeMemory(organizationId: string, raw: unknown): Promise<{ ok: boolean; reason?: string; trust?: MemoryTrust }> {
  const parsed = memoryWriteSchema.parse(raw);
  if (parsed.organizationId && parsed.organizationId !== organizationId) {
    return { ok: false, reason: 'payload organizationId does not match the authenticated organization' };
  }
  const req: MemoryWriteRequest = { ...parsed, organizationId };
  const existingRows = await db()<Array<{ trust: MemoryTrust; explicit: boolean; revokedAt: string | null }>>`
    select trust, explicit, revoked_at from public.markting_memory
    where organization_id = ${organizationId} and category = ${req.category} and key = ${req.key} limit 1`;
  const existing = existingRows[0] ? { trust: existingRows[0].trust, explicit: existingRows[0].explicit, revokedAtPresent: existingRows[0].revokedAt != null } : null;
  const policy = evaluateWritePolicy(req, existing);
  if (!policy.allowed) return { ok: false, reason: policy.reason, trust: policy.trust };

  await db()`
    insert into public.markting_memory
      (organization_id, category, key, value, source, source_reference, trust, explicit, confidence, created_at, last_verified_at, expires_at)
    values
      (${organizationId}, ${req.category}, ${req.key}, ${db().json(req.value as never)}, ${req.source}, ${req.sourceReference ?? null},
       ${policy.trust}, ${req.explicit}, ${req.confidence ?? null}, now(), now(), ${req.expiresAt ?? null})
    on conflict (organization_id, category, key) do update set
      value = excluded.value, source = excluded.source, source_reference = excluded.source_reference,
      trust = excluded.trust, explicit = excluded.explicit, confidence = excluded.confidence,
      last_verified_at = now(), expires_at = excluded.expires_at, revoked_at = null`;
  return { ok: true, trust: policy.trust };
}

export async function listMemory(organizationId: string, opts: { category?: MemoryCategory; activeOnly?: boolean } = {}): Promise<MemoryItem[]> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select * from public.markting_memory
    where organization_id = ${organizationId}
      ${opts.category ? db()`and category = ${opts.category}` : db()``}
    order by category, key`;
  const items = rows.map(rowToItem);
  return opts.activeOnly ? items.filter((i) => isActive(i)) : items;
}

export async function getMemory(organizationId: string, category: MemoryCategory, key: string): Promise<MemoryItem | null> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select * from public.markting_memory where organization_id = ${organizationId} and category = ${category} and key = ${key} limit 1`;
  return rows[0] ? rowToItem(rows[0]) : null;
}

/** Human correction (3F): only a human source may correct; recomputes trust and clears any revocation. */
export async function correctMemory(organizationId: string, category: MemoryCategory, key: string, value: unknown, source: 'human_config' | 'human_confirmation'): Promise<{ ok: boolean; reason?: string }> {
  return writeMemory(organizationId, { category, key, value, source, explicit: true });
}

/** Forget/invalidate (3F): soft-revoke (REVOKED) — never a silent rewrite of history. */
export async function revokeMemory(organizationId: string, category: MemoryCategory, key: string): Promise<{ ok: boolean }> {
  const rows = await db()<Array<{ id: string }>>`
    update public.markting_memory set trust = 'REVOKED', revoked_at = now()
    where organization_id = ${organizationId} and category = ${category} and key = ${key} and revoked_at is null
    returning id`;
  return { ok: rows.length > 0 };
}

/** Mark an item STALE (e.g. past a verification horizon). Pure-ish helper for retention/verification. */
export async function markStale(organizationId: string, category: MemoryCategory, key: string): Promise<void> {
  await db()`update public.markting_memory set trust = 'STALE' where organization_id = ${organizationId} and category = ${category} and key = ${key} and revoked_at is null and trust not in ('EXPLICIT_HUMAN')`;
}

// db() camelCases column names on read.
function rowToItem(row: Record<string, unknown>): MemoryItem {
  return {
    organizationId: row.organizationId as string,
    category: row.category as MemoryCategory,
    key: row.key as string,
    value: row.value,
    source: row.source as MemoryItem['source'],
    sourceReference: (row.sourceReference as string) ?? undefined,
    trust: row.trust as MemoryTrust,
    explicit: row.explicit as boolean,
    confidence: (row.confidence as string) ?? undefined,
    createdAt: new Date(row.createdAt as string).toISOString(),
    lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt as string).toISOString() : undefined,
    expiresAt: row.expiresAt ? new Date(row.expiresAt as string).toISOString() : undefined,
    revokedAt: row.revokedAt ? new Date(row.revokedAt as string).toISOString() : undefined,
  };
}
