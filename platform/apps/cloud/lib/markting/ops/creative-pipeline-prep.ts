import 'server-only';
import { createHash } from 'node:crypto';
import type { EngineContext } from '../engine-context';
import type { VisualAnalysis } from '../creative/visual';
import type { AnalyzeImageInput } from '../creative/multimodal-gateway';
import { BlockedExternalError } from './ai-provider-adapter';

/**
 * PHASE C.6 (34 + 35) — CREATIVE PIPELINE PREP + MODEL BOUNDARY.
 *
 * A creative generation/analysis pipeline SHELL with an EXPLICIT model boundary (item 35): the
 * `StageExecution` type on every stage makes it unambiguous which work is LOCAL_DETERMINISTIC (content
 * hashing, dedup, metadata extraction via the multimodal-gateway fallback, policy checks) and which
 * REQUIRES_LIVE_MODEL (actual image/video generation — BLOCKED_EXTERNAL, stubbed). The pipeline runs
 * end-to-end on the local/metadata-only path and MARKS model-requiring stages BLOCKED_EXTERNAL without
 * invoking them. No image/video is generated, nothing is published — `published` is always false.
 */

export type StageExecution = 'LOCAL_DETERMINISTIC' | 'REQUIRES_LIVE_MODEL';

export interface PipelineStageDef {
  name: string;
  execution: StageExecution;
  description: string;
}

/** The model boundary, declared once: everything a live creative model is NOT needed for is local. */
export const CREATIVE_PIPELINE_STAGES: ReadonlyArray<PipelineStageDef> = [
  { name: 'content_hash', execution: 'LOCAL_DETERMINISTIC', description: 'sha256 of normalized source bytes (dedup key)' },
  { name: 'dedup', execution: 'LOCAL_DETERMINISTIC', description: 'skip assets already seen (cost control)' },
  { name: 'policy_check', execution: 'LOCAL_DETERMINISTIC', description: 'deterministic brand/safety policy over the brief + copy' },
  { name: 'metadata_analysis', execution: 'LOCAL_DETERMINISTIC', description: 'metadata-only visual analysis via the multimodal-gateway fallback' },
  { name: 'creative_generation', execution: 'REQUIRES_LIVE_MODEL', description: 'image/video synthesis — needs a live creative model (BLOCKED_EXTERNAL)' },
];

export type StageStatus = 'DONE' | 'SKIPPED_DUPLICATE' | 'POLICY_BLOCKED' | 'BLOCKED_EXTERNAL';

export interface StageResult {
  stage: string;
  execution: StageExecution;
  status: StageStatus;
  evidence?: string;
}

export interface PipelineResult {
  contentHash: string;
  duplicate: boolean;
  /** True — the analysis never used a live model (metadata-only), never fabricated. */
  metadataOnly: boolean;
  /** Policy verdict for the generation brief + copy. */
  policyOk: boolean;
  policyReasons: string[];
  visual?: VisualAnalysis;
  stages: StageResult[];
  /** Stage names marked BLOCKED_EXTERNAL (require a live model that is not wired). */
  blockedStages: string[];
  /** INVARIANT: the shell never publishes autonomously. */
  published: false;
}

/** The dedup index port (injected). A content hash already present means we skip re-processing. */
export interface DedupIndex {
  has(hash: string): boolean;
  add(hash: string): void;
}

export class InMemoryDedupIndex implements DedupIndex {
  private readonly s = new Set<string>();
  has(hash: string): boolean {
    return this.s.has(hash);
  }
  add(hash: string): void {
    this.s.add(hash);
  }
}

/** The local metadata-only analyzer port — structurally satisfied by the MultimodalGateway. */
export interface LocalVisualAnalyzer {
  analyzeImage(input: AnalyzeImageInput): Promise<{ analysis: VisualAnalysis; cached: boolean }>;
}

/**
 * The live creative-model seam, DISABLED by construction. The pipeline NEVER calls it — the stage is marked
 * BLOCKED_EXTERNAL from the boundary table. It exists only to document the seam; `generate` throws so a
 * live generation can never happen credential-free.
 */
export interface CreativeModelPort {
  generate(brief: string): Promise<never>;
}

export class BlockedCreativeModel implements CreativeModelPort {
  async generate(_brief: string): Promise<never> {
    throw new BlockedExternalError('live creative model (image/video synthesis) not wired');
  }
}

export interface CreativePolicy {
  /** Lowercased terms that must not appear in the brief or copy. */
  bannedTerms: ReadonlyArray<string>;
}

export const DEFAULT_CREATIVE_POLICY: CreativePolicy = {
  bannedTerms: ['guaranteed returns', 'miracle cure', 'risk-free', 'get rich quick'],
};

/** Normalize text the same way for hashing and policy (lowercase + collapse whitespace). */
function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Deterministic content hash over the normalized source content. */
export function contentHashOf(sourceContent: string): string {
  return createHash('sha256').update(normalize(sourceContent)).digest('hex');
}

export interface CreativePipelineInput {
  ctx: EngineContext;
  requestId: string;
  now: number;
  asset: { sourceContent: string; bytes?: number; mediaType: 'image' | 'video' | 'text' };
  /** The generation brief + ad copy — DATA to screen, never an instruction to act. */
  brief?: { prompt?: string; copy?: string };
}

/**
 * The pipeline shell. Deterministic over the injected analyzer + dedup index + policy. It runs the local
 * path to completion, applies the dedup/policy guards, and marks every REQUIRES_LIVE_MODEL stage
 * BLOCKED_EXTERNAL without touching the model. It returns a fully explainable `PipelineResult`.
 */
export class CreativePipelinePrep {
  constructor(
    private readonly analyzer: LocalVisualAnalyzer,
    private readonly dedup: DedupIndex,
    private readonly policy: CreativePolicy = DEFAULT_CREATIVE_POLICY,
  ) {}

  async run(input: CreativePipelineInput): Promise<PipelineResult> {
    const stages: StageResult[] = [];
    const blockedStages: string[] = [];

    // Stage 1 — content hash (LOCAL).
    const contentHash = contentHashOf(input.asset.sourceContent);
    stages.push({ stage: 'content_hash', execution: 'LOCAL_DETERMINISTIC', status: 'DONE', evidence: `sha256:${contentHash.slice(0, 12)}` });

    // Stage 2 — dedup (LOCAL). A duplicate short-circuits the rest (cost control), still fully reported.
    const duplicate = this.dedup.has(contentHash);
    if (duplicate) {
      stages.push({ stage: 'dedup', execution: 'LOCAL_DETERMINISTIC', status: 'SKIPPED_DUPLICATE', evidence: 'content_hash_seen' });
      for (const s of CREATIVE_PIPELINE_STAGES) {
        if (s.name === 'content_hash' || s.name === 'dedup') continue;
        const status: StageStatus = s.execution === 'REQUIRES_LIVE_MODEL' ? 'BLOCKED_EXTERNAL' : 'SKIPPED_DUPLICATE';
        if (status === 'BLOCKED_EXTERNAL') blockedStages.push(s.name);
        stages.push({ stage: s.name, execution: s.execution, status, evidence: status === 'BLOCKED_EXTERNAL' ? 'requires_live_model_not_wired' : 'skipped_duplicate' });
      }
      return { contentHash, duplicate: true, metadataOnly: true, policyOk: true, policyReasons: [], stages, blockedStages, published: false };
    }
    stages.push({ stage: 'dedup', execution: 'LOCAL_DETERMINISTIC', status: 'DONE', evidence: 'novel_asset' });
    this.dedup.add(contentHash);

    // Stage 3 — policy check (LOCAL).
    const hay = normalize([input.brief?.prompt ?? '', input.brief?.copy ?? ''].join(' '));
    const policyReasons = this.policy.bannedTerms.filter((t) => hay.includes(normalize(t)));
    const policyOk = policyReasons.length === 0;
    stages.push({
      stage: 'policy_check', execution: 'LOCAL_DETERMINISTIC',
      status: policyOk ? 'DONE' : 'POLICY_BLOCKED',
      evidence: policyOk ? 'policy_ok' : `banned_terms:${policyReasons.length}`,
    });

    // Stage 4 — metadata analysis (LOCAL, metadata-only via the multimodal-gateway fallback).
    const { analysis } = await this.analyzer.analyzeImage({
      ctx: input.ctx, sourceHash: contentHash, bytes: input.asset.bytes, requestId: input.requestId, now: input.now,
    });
    stages.push({ stage: 'metadata_analysis', execution: 'LOCAL_DETERMINISTIC', status: 'DONE', evidence: `metadataOnly:${analysis.metadataOnly}` });

    // Stage 5 — creative generation (REQUIRES_LIVE_MODEL). MARKED, never invoked.
    blockedStages.push('creative_generation');
    stages.push({
      stage: 'creative_generation', execution: 'REQUIRES_LIVE_MODEL', status: 'BLOCKED_EXTERNAL',
      evidence: policyOk ? 'requires_live_model_not_wired' : 'blocked_and_policy_failed',
    });

    return {
      contentHash, duplicate: false, metadataOnly: analysis.metadataOnly, policyOk, policyReasons,
      visual: analysis, stages, blockedStages, published: false,
    };
  }
}
