# 06 — Multimodal Architecture, Visual/Video Foundations, Cost & Versioning (4J/4K/4L)

## Visual & video foundations (4J/4K) — `creative/visual.ts`

Structured feature schema with two hard rules:
1. **No fabrication of unseen content.** Without a multimodal model result, EVERY visual/video feature
   is `UNKNOWN` (tri-state PRESENT/ABSENT/UNKNOWN). Features are never guessed from the copy or
   filename. `buildVisualAnalysis`/`buildVideoAnalysis` return `metadataOnly: true` when no model saw
   the asset.
2. **No protected-trait / identity inference.** There are deliberately NO schema fields for age,
   gender, ethnicity, religion, health, orientation, or identity (`FORBIDDEN_VISUAL_INFERENCES`).
   `face_present` is only ever "a face is present", never "whose".

Visual features: text_density, product/human/face/logo present, cta_overlay, before_after, ugc_style,
studio_style, testimonial_layout, screenshot_ui, + layout type. Video: duration, scene count, hook/CTA/
product-reveal timing, captions/voiceover/overlays/UGC, pace — only when a model supplies them;
transcript is DATA only (never instructions).

## Multimodal gateway (4L) — `creative/multimodal-gateway.ts`

Wraps the Phase-1 governed `AiGateway`, adding media controls:
- **Cost control:** size limits (image bytes, video bytes/duration/keyframes), a content-hash cache
  (`AnalysisCache`) so an UNCHANGED asset is never re-analyzed, per-org accounting through the ledger.
- **Security:** provider access credentials are NEVER sent to the model provider — only signed/internal
  asset references. Oversize media is rejected (`INVALID_INPUT`) before any model call.
- **No live model here:** `run()` returns the deterministic metadata-only analysis (recorded free as
  `local_fallback`). Live multimodal is **BLOCKED_EXTERNAL**.

## Analysis versioning

`markting_creative_analysis` is VERSIONED (`analysis_version` + `model` + `source_hash`) and
**insert-only** — a prior analysis version is never silently overwritten, so creative interpretation
history that may back an outcome stays intact. Re-analysis after a taxonomy/model/prompt change is
explicit (a new version row).
