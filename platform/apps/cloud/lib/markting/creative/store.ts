import 'server-only';
import { db } from '@/lib/db';
import { MIN_SAMPLE_FOR_CONFIDENCE } from '../data-trust';
import { writeMemory } from '../memory-store';
import type { Creative } from './model';

/**
 * Phase 4 creative persistence (tenant-scoped). ANALYSIS ONLY — no provider-write path. Analysis rows
 * are versioned and insert-only (cache + preserved history). Creative memory (4T) reuses the Phase-3
 * memory service: a DERIVED creative pattern may only be stored with a sufficient SAMPLE and
 * provenance — "blue backgrounds always win" from n=3 is refused.
 */

export async function upsertCreative(organizationId: string, c: Creative): Promise<void> {
  if (c.organizationId !== organizationId) throw new Error('creative organization mismatch');
  await db()`
    insert into public.markting_creatives
      (id, organization_id, raw_id, provider, account_id, campaign_id, ad_group_id, ad_id, media_type, status,
       first_seen, last_seen, active, text, performance, trust, raw, created_at, updated_at)
    values
      (${c.id}, ${organizationId}, ${c.rawId}, ${c.provider}, ${c.accountId}, ${c.campaignId ?? null}, ${c.adGroupId ?? null}, ${c.adId ?? null},
       ${c.mediaType}, ${c.status ?? null}, ${c.firstSeen ?? null}, ${c.lastSeen ?? null}, ${c.active ?? null},
       ${c.text ? db().json(c.text as never) : null}, ${db().json(c.performance as never)}, ${db().json(c.trust as never)}, ${c.raw ? db().json(c.raw as never) : null}, now(), now())
    on conflict (organization_id, id) do update set
      status = excluded.status, last_seen = excluded.last_seen, active = excluded.active,
      text = excluded.text, performance = excluded.performance, trust = excluded.trust, updated_at = now()`;
  for (const a of c.assets) {
    await db()`
      insert into public.markting_creative_assets
        (organization_id, creative_id, asset_id, raw_asset_id, provider, media_type, reference, width, height, duration_sec, format, content_hash, raw)
      values
        (${organizationId}, ${c.id}, ${a.assetId}, ${a.rawAssetId}, ${a.provider}, ${a.mediaType}, ${a.reference ?? null},
         ${a.width ?? null}, ${a.height ?? null}, ${a.durationSec ?? null}, ${a.format ?? null}, ${a.contentHash ?? null}, ${a.raw ? db().json(a.raw as never) : null})
      on conflict (organization_id, creative_id, asset_id) do update set content_hash = excluded.content_hash, reference = excluded.reference`;
  }
}

export async function listCreatives(organizationId: string, filter: { accountId?: string; campaignId?: string } = {}): Promise<Array<Record<string, unknown>>> {
  return db()<Array<Record<string, unknown>>>`
    select * from public.markting_creatives
    where organization_id = ${organizationId}
      ${filter.accountId ? db()`and account_id = ${filter.accountId}` : db()``}
      ${filter.campaignId ? db()`and campaign_id = ${filter.campaignId}` : db()``}
    order by updated_at desc limit 5000`;
}

export interface SaveAnalysisInput { creativeId: string; analysisType: 'text' | 'visual' | 'video' | 'fatigue' | 'classification' | 'lifecycle' | 'rating'; analysisVersion: string; model?: string; sourceHash?: string; result: unknown }

/** Insert-only versioned analysis (cache + preserved history). Returns false if that version already existed. */
export async function saveAnalysis(organizationId: string, a: SaveAnalysisInput): Promise<{ stored: boolean }> {
  const rows = await db()<Array<{ id: string }>>`
    insert into public.markting_creative_analysis (organization_id, creative_id, analysis_type, analysis_version, model, source_hash, result)
    values (${organizationId}, ${a.creativeId}, ${a.analysisType}, ${a.analysisVersion}, ${a.model ?? 'none'}, ${a.sourceHash ?? null}, ${db().json(a.result as never)})
    on conflict (organization_id, creative_id, analysis_type, analysis_version, source_hash) do nothing
    returning id`;
  return { stored: rows.length > 0 };
}

export async function getAnalysis(organizationId: string, creativeId: string, analysisType: SaveAnalysisInput['analysisType'], analysisVersion: string, sourceHash?: string): Promise<unknown | null> {
  const rows = await db()<Array<{ result: unknown }>>`
    select result from public.markting_creative_analysis
    where organization_id = ${organizationId} and creative_id = ${creativeId} and analysis_type = ${analysisType}
      and analysis_version = ${analysisVersion} and source_hash is not distinct from ${sourceHash ?? null} limit 1`;
  return rows[0]?.result ?? null;
}

export async function saveSignal(organizationId: string, s: { creativeId: string; kind: string; state: string; confidence?: string; evidence?: Record<string, unknown>; analysisVersion?: string }): Promise<void> {
  await db()`
    insert into public.markting_creative_signals (organization_id, creative_id, kind, state, confidence, evidence, analysis_version)
    values (${organizationId}, ${s.creativeId}, ${s.kind}, ${s.state}, ${s.confidence ?? null}, ${db().json((s.evidence ?? {}) as never)}, ${s.analysisVersion ?? null})`;
}

export async function saveCluster(organizationId: string, c: { clusterId: string; definingFeatures: string[]; sampleSize: number; performance: Record<string, unknown>; trustTier?: string; creativeIds: string[] }): Promise<void> {
  await db()`
    insert into public.markting_creative_clusters (id, organization_id, defining_features, sample_size, performance, trust_tier, updated_at)
    values (${c.clusterId}, ${organizationId}, ${db().json(c.definingFeatures as never)}, ${c.sampleSize}, ${db().json(c.performance as never)}, ${c.trustTier ?? null}, now())
    on conflict (organization_id, id) do update set defining_features = excluded.defining_features, sample_size = excluded.sample_size, performance = excluded.performance, trust_tier = excluded.trust_tier, updated_at = now()`;
  for (const creativeId of c.creativeIds) {
    await db()`insert into public.markting_creative_memberships (organization_id, cluster_id, creative_id)
               values (${organizationId}, ${c.clusterId}, ${creativeId})
               on conflict (organization_id, cluster_id, creative_id) do nothing`;
  }
}

/**
 * Creative memory (4T): store a VERIFIED creative pattern, with sample + provenance. A derived pattern
 * from a tiny sample is REFUSED — historical creative patterns need enough evidence, so the system
 * never records "pattern X always wins" from a handful of conversions.
 */
export async function rememberCreativePattern(organizationId: string, input: { key: string; value: Record<string, unknown>; sampleSize: number; provenance: 'system_verification' | 'derived_analysis'; sourceReference?: string }): Promise<{ ok: boolean; reason?: string }> {
  if (input.provenance === 'derived_analysis' && input.sampleSize < MIN_SAMPLE_FOR_CONFIDENCE) {
    return { ok: false, reason: `derived creative pattern needs >= ${MIN_SAMPLE_FOR_CONFIDENCE} sample, got ${input.sampleSize}` };
  }
  return writeMemory(organizationId, {
    category: 'historical_outcome', key: input.key, value: { ...input.value, sampleSize: input.sampleSize },
    source: input.provenance, sourceReference: input.sourceReference, explicit: false,
  });
}
