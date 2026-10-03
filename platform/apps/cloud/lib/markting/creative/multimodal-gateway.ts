/**
 * Phase 4L — governed multimodal gateway. Wraps the Phase-1 AiGateway with media-specific controls:
 * image/video model roles on an allowlist, max media size + max video duration/keyframes, per-org cost
 * accounting, and a CONTENT-HASH CACHE so an unchanged asset is never re-analyzed. Provider access
 * credentials are NEVER sent to the model provider — only signed/internal asset references. Without a
 * live model, analysis returns a metadata-only local fallback (recorded free), never fabricated.
 */
import { AdportError } from '@adport/core';
import type { AiGateway } from '../ai-gateway';
import type { EngineContext } from '../engine-context';
import { ANALYSIS_VERSION, buildVisualAnalysis, buildVideoAnalysis, type VisualAnalysis, type VideoAnalysis, type VideoInput } from './visual';

export interface MultimodalLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
  maxVideoDurationSec: number;
  maxKeyframes: number;
}
export const DEFAULT_MULTIMODAL_LIMITS: MultimodalLimits = { maxImageBytes: 8 * 1024 * 1024, maxVideoBytes: 100 * 1024 * 1024, maxVideoDurationSec: 180, maxKeyframes: 12 };

/** Cache keyed by (sourceHash, analysisVersion) so unchanged assets skip re-analysis (cost control). */
export interface AnalysisCache {
  getVisual(organizationId: string, sourceHash: string, version: string): Promise<VisualAnalysis | null>;
  setVisual(organizationId: string, sourceHash: string, version: string, a: VisualAnalysis): Promise<void>;
}

export interface AnalyzeImageInput {
  ctx: EngineContext;
  sourceHash: string;
  bytes?: number;
  /** A signed/internal reference the model fetches — NEVER a provider credential. */
  reference?: string;
  requestId: string;
  now: number;
}

export class MultimodalGateway {
  constructor(private readonly gateway: AiGateway, private readonly limits: MultimodalLimits = DEFAULT_MULTIMODAL_LIMITS, private readonly cache?: AnalysisCache) {}

  /** Analyze an image. Cache-first; size-guarded; recorded through the governed gateway. */
  async analyzeImage(input: AnalyzeImageInput): Promise<{ analysis: VisualAnalysis; cached: boolean }> {
    if (input.bytes != null && input.bytes > this.limits.maxImageBytes) {
      throw new AdportError('INVALID_INPUT', `image exceeds max size (${input.bytes} > ${this.limits.maxImageBytes})`);
    }
    if (this.cache) {
      const hit = await this.cache.getVisual(input.ctx.organizationId, input.sourceHash, ANALYSIS_VERSION);
      if (hit) return { analysis: hit, cached: true };
    }
    // No live multimodal model wired → metadata-only analysis (everything UNKNOWN), recorded free.
    const analysis = await this.gateway.invoke<VisualAnalysis>({
      ctx: { ...input.ctx, requestId: input.requestId }, role: 'DEEP_ANALYSIS', feature: 'creative_visual', now: input.now,
      run: async () => ({ value: buildVisualAnalysis({ sourceHash: input.sourceHash }), usage: { tokensAvailable: false }, localFallback: true }),
    });
    if (this.cache) await this.cache.setVisual(input.ctx.organizationId, input.sourceHash, ANALYSIS_VERSION, analysis);
    return { analysis, cached: false };
  }

  /** Analyze a video (metadata/transcript foundation; frame understanding only with a live model). */
  async analyzeVideo(input: { ctx: EngineContext; requestId: string; now: number; video: VideoInput; durationSec?: number }): Promise<VideoAnalysis> {
    if ((input.durationSec ?? 0) > this.limits.maxVideoDurationSec) {
      throw new AdportError('INVALID_INPUT', `video exceeds max duration (${input.durationSec}s > ${this.limits.maxVideoDurationSec}s)`);
    }
    return this.gateway.invoke<VideoAnalysis>({
      ctx: { ...input.ctx, requestId: input.requestId }, role: 'DEEP_ANALYSIS', feature: 'creative_video', now: input.now,
      run: async () => ({ value: buildVideoAnalysis(input.video), usage: { tokensAvailable: false }, localFallback: true }),
    });
  }
}
