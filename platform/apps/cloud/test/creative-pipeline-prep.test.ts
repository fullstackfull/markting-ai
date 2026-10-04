import { describe, expect, it } from 'vitest';
import {
  CreativePipelinePrep, InMemoryDedupIndex, BlockedCreativeModel, contentHashOf,
  CREATIVE_PIPELINE_STAGES, DEFAULT_CREATIVE_POLICY, type CreativePipelineInput,
} from '@/lib/markting/ops/creative-pipeline-prep';
import { BlockedExternalError } from '@/lib/markting/ops/ai-provider-adapter';
import { MultimodalGateway } from '@/lib/markting/creative/multimodal-gateway';
import { AiGateway, DEMO_GATEWAY_CONFIG } from '@/lib/markting/ai-gateway';
import { InMemoryUsageLedger } from '@/lib/markting/usage-ledger';
import type { EngineContext } from '@/lib/markting/engine-context';

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return { organizationId: 'org-1', userId: 'u-1', requestId: 'req-1', locale: 'ar', timezone: 'Asia/Riyadh', mode: 'LIVE_RECOMMENDATIONS', scope: 'recommend', ...over };
}
const NOW = 1_770_000_000_000;

function analyzer(): MultimodalGateway {
  return new MultimodalGateway(new AiGateway(DEMO_GATEWAY_CONFIG, new InMemoryUsageLedger()));
}

function input(over: Partial<CreativePipelineInput> = {}): CreativePipelineInput {
  return { ctx: ctx(), requestId: 'req-1', now: NOW, asset: { sourceContent: 'bytes-of-a-banner.png', mediaType: 'image' }, brief: { prompt: 'bright summer sale banner', copy: '50% off today' }, ...over };
}

describe('C.6-34/35 — creative pipeline prep + model boundary', () => {
  it('declares an explicit model boundary (local vs requires-live-model)', () => {
    const local = CREATIVE_PIPELINE_STAGES.filter((s) => s.execution === 'LOCAL_DETERMINISTIC').map((s) => s.name);
    const liveModel = CREATIVE_PIPELINE_STAGES.filter((s) => s.execution === 'REQUIRES_LIVE_MODEL').map((s) => s.name);
    expect(local).toContain('content_hash');
    expect(local).toContain('dedup');
    expect(local).toContain('policy_check');
    expect(local).toContain('metadata_analysis');
    expect(liveModel).toEqual(['creative_generation']);
  });

  it('runs end-to-end on the local/metadata-only path and marks generation BLOCKED_EXTERNAL', async () => {
    const pipe = new CreativePipelinePrep(analyzer(), new InMemoryDedupIndex());
    const r = await pipe.run(input());
    expect(r.contentHash).toBe(contentHashOf('bytes-of-a-banner.png'));
    expect(r.duplicate).toBe(false);
    expect(r.metadataOnly).toBe(true); // reused multimodal-gateway fallback, nothing fabricated
    expect(r.visual?.model).toBe('none');
    expect(r.policyOk).toBe(true);
    expect(r.blockedStages).toEqual(['creative_generation']);
    expect(r.stages.find((s) => s.stage === 'creative_generation')?.status).toBe('BLOCKED_EXTERNAL');
    expect(r.published).toBe(false); // never autonomous publishing
  });

  it('deduplicates a repeated asset and short-circuits downstream stages', async () => {
    const dedup = new InMemoryDedupIndex();
    const pipe = new CreativePipelinePrep(analyzer(), dedup);
    await pipe.run(input());
    const second = await pipe.run(input());
    expect(second.duplicate).toBe(true);
    expect(second.stages.find((s) => s.stage === 'dedup')?.status).toBe('SKIPPED_DUPLICATE');
    expect(second.stages.find((s) => s.stage === 'metadata_analysis')?.status).toBe('SKIPPED_DUPLICATE');
    // The live-model stage stays BLOCKED_EXTERNAL even on the duplicate path.
    expect(second.blockedStages).toEqual(['creative_generation']);
    expect(second.published).toBe(false);
  });

  it('blocks copy that violates the deterministic policy', async () => {
    const pipe = new CreativePipelinePrep(analyzer(), new InMemoryDedupIndex());
    const r = await pipe.run(input({ asset: { sourceContent: 'other.png', mediaType: 'image' }, brief: { copy: 'guaranteed returns, risk-free!' } }));
    expect(r.policyOk).toBe(false);
    expect(r.policyReasons).toEqual(expect.arrayContaining(['guaranteed returns', 'risk-free']));
    expect(r.stages.find((s) => s.stage === 'policy_check')?.status).toBe('POLICY_BLOCKED');
    expect(r.published).toBe(false);
  });

  it('content hash is deterministic and normalization-stable', () => {
    expect(contentHashOf('Hello  World')).toBe(contentHashOf('hello world'));
    expect(contentHashOf('a')).not.toBe(contentHashOf('b'));
  });

  it('the live creative-model seam is a BLOCKED_EXTERNAL stub, never invoked by the pipeline', async () => {
    const model = new BlockedCreativeModel();
    await expect(model.generate('make me a hero image')).rejects.toThrow(/BLOCKED_EXTERNAL/);
    await expect(model.generate('x')).rejects.toBeInstanceOf(BlockedExternalError);
  });

  it('exposes the default policy terms', () => {
    expect(DEFAULT_CREATIVE_POLICY.bannedTerms.length).toBeGreaterThan(0);
  });
});
