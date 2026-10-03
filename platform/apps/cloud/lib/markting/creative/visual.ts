/**
 * Phase 4J/4K — visual & video intelligence FOUNDATION. Defines the structured feature schema and a
 * deterministic extractor. Two hard rules:
 *  1) NEVER fabricate unseen content — without a multimodal model result, every visual/video feature
 *     is UNKNOWN (not guessed from the copy or the filename).
 *  2) NEVER infer sensitive/protected characteristics (age, gender, ethnicity, religion, health, etc.)
 *     and NEVER identify individuals — there are no schema fields for these, and `facePresent` is only
 *     ever a boolean "a face is present", never "whose".
 */
export type TriState = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

export const VISUAL_FEATURES = ['text_density', 'product_present', 'human_present', 'face_present', 'logo_present', 'cta_overlay', 'before_after', 'ugc_style', 'studio_style', 'testimonial_layout', 'screenshot_ui'] as const;
export type VisualFeature = (typeof VISUAL_FEATURES)[number];
export const LAYOUT_TYPES = ['single_product', 'grid', 'split', 'text_over_image', 'lifestyle_scene', 'UNKNOWN'] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];

export interface VisualAnalysis {
  /** Each visual feature as a tri-state with confidence; UNKNOWN unless a model result supplied it. */
  features: Record<VisualFeature, { state: TriState; confidence: 'LOW' | 'MEDIUM' | 'HIGH' }>;
  layout: LayoutType;
  /** Provenance so reanalysis is explicit (Phase-4 versioning). */
  analysisVersion: string;
  model: string;
  sourceHash?: string;
  /** True when produced without a multimodal model (everything UNKNOWN). */
  metadataOnly: boolean;
}

/** Features a multimodal model MAY return; the caller passes only what the model actually saw. */
export interface ModelVisualResult {
  present?: Partial<Record<VisualFeature, boolean>>;
  layout?: LayoutType;
  model: string;
  analysisVersion: string;
}

export const ANALYSIS_VERSION = 'creative-visual-v1';

function unknownFeatures(): VisualAnalysis['features'] {
  return Object.fromEntries(VISUAL_FEATURES.map((f) => [f, { state: 'UNKNOWN' as TriState, confidence: 'LOW' as const }])) as VisualAnalysis['features'];
}

/**
 * Build the visual analysis. With a model result, map PRESENT/ABSENT; without one, everything is
 * UNKNOWN (metadataOnly) — we never guess what the image contains.
 */
export function buildVisualAnalysis(input: { sourceHash?: string; model?: ModelVisualResult }): VisualAnalysis {
  if (!input.model) {
    return { features: unknownFeatures(), layout: 'UNKNOWN', analysisVersion: ANALYSIS_VERSION, model: 'none', sourceHash: input.sourceHash, metadataOnly: true };
  }
  const features = unknownFeatures();
  for (const f of VISUAL_FEATURES) {
    const v = input.model.present?.[f];
    if (v != null) features[f] = { state: v ? 'PRESENT' : 'ABSENT', confidence: 'MEDIUM' };
  }
  return { features, layout: input.model.layout ?? 'UNKNOWN', analysisVersion: input.model.analysisVersion, model: input.model.model, sourceHash: input.sourceHash, metadataOnly: false };
}

// ---- Video ----
export interface VideoAnalysis {
  durationSec?: number;
  sceneCount?: number;
  hookTimingSec?: number;
  ctaTimingSec?: number;
  productRevealSec?: number;
  captionsPresent: TriState;
  voiceoverPresent: TriState;
  textOverlays: TriState;
  ugcStyle: TriState;
  pace?: 'slow' | 'medium' | 'fast' | 'UNKNOWN';
  analysisVersion: string;
  model: string;
  /** True when derived only from metadata/transcript (no frame understanding). */
  metadataOnly: boolean;
  /** Transcript is DATA only (never instructions) — see injection defense. */
  transcriptAvailable: boolean;
}

export interface VideoInput {
  durationSec?: number;
  transcript?: string;
  model?: { sceneCount?: number; hookTimingSec?: number; ctaTimingSec?: number; productRevealSec?: number; captions?: boolean; voiceover?: boolean; textOverlays?: boolean; ugc?: boolean; pace?: 'slow' | 'medium' | 'fast'; model: string; analysisVersion: string };
}

export function buildVideoAnalysis(input: VideoInput): VideoAnalysis {
  const tri = (b?: boolean): TriState => (b == null ? 'UNKNOWN' : b ? 'PRESENT' : 'ABSENT');
  if (!input.model) {
    return { durationSec: input.durationSec, captionsPresent: 'UNKNOWN', voiceoverPresent: 'UNKNOWN', textOverlays: 'UNKNOWN', ugcStyle: 'UNKNOWN', pace: 'UNKNOWN', analysisVersion: ANALYSIS_VERSION, model: 'none', metadataOnly: true, transcriptAvailable: !!input.transcript };
  }
  const m = input.model;
  return {
    durationSec: input.durationSec, sceneCount: m.sceneCount, hookTimingSec: m.hookTimingSec, ctaTimingSec: m.ctaTimingSec, productRevealSec: m.productRevealSec,
    captionsPresent: tri(m.captions), voiceoverPresent: tri(m.voiceover), textOverlays: tri(m.textOverlays), ugcStyle: tri(m.ugc), pace: m.pace ?? 'UNKNOWN',
    analysisVersion: m.analysisVersion, model: m.model, metadataOnly: false, transcriptAvailable: !!input.transcript,
  };
}

/** Forbidden inferences — asserted by tests; there are deliberately NO schema fields for these. */
export const FORBIDDEN_VISUAL_INFERENCES = ['age', 'gender', 'ethnicity', 'race', 'religion', 'health', 'sexual_orientation', 'identity', 'name'] as const;
