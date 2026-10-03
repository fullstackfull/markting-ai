# Phase 4 — Baseline

Branch `claude/amazing-heisenberg-0unnak`. Phase 3 exit `299460c` (Phase 2 `48982b9`, Phase 1
`3e91494`, Phase 0 `e6fbd0c`).

Phase 4 adds CREATIVE ASSET UNDERSTANDING → CREATIVE PERFORMANCE → FATIGUE SIGNALS → CLUSTERING →
PATTERN DISCOVERY → CREATIVE RECOMMENDATIONS, turning "the campaign's CTR declined" into "the decline
is concentrated in these creatives; it began after frequency rose; a product-first video cluster is
outperforming the older testimonial cluster — as a temporal association, not a proven cause".

## ABSOLUTE SAFETY RULE (held throughout)

Phase 4 is **ANALYSIS ONLY**. The AI may inspect/classify/compare creatives, detect fatigue signals,
find patterns, and recommend tests/reviews. It may **not** publish, upload, replace, pause, create, or
modify any creative or campaign. **No provider-write capability is added.** The registry read-only gate
(Phase 1B) and the Phase-0 human-approved write path are unchanged; creative recommendations are typed
review labels only (no endpoint/path/body), exactly like Phase 2.

## Environment reality (verified — unchanged from Phase 3)

| Capability | State | Consequence |
|---|---|---|
| GitHub Actions runner | AVAILABLE | CI incl. the real-Postgres DB lane is run for real; Phase-4 tables get DB-isolation tests. |
| Live provider creative APIs (Meta/TikTok/Google/Snapchat) | NOT PRESENT | ingestion is SYNTHETIC_PROVEN via fixtures through the same normalized boundary; live transport BLOCKED_EXTERNAL; no fabricated proof. |
| Image/video multimodal model | NOT PRESENT | the multimodal gateway + extraction schema are built; analysis runs with a deterministic metadata-only local fallback that NEVER fabricates unseen visual/video content; live multimodal BLOCKED_EXTERNAL. |
| Local Supabase/Postgres | DOWN | DB-gated suites run only in the CI `cloud-db` lane. |

Tags: **RUNTIME_PROVEN** (real runtime — CI DB lane), **SYNTHETIC_PROVEN** (proven against the typed
boundary + fixtures), **BLOCKED_EXTERNAL** (needs infra/creds absent here).

## Built on (not rebuilt)

Phase 2 `intelligence/creative.ts` (fatigue-signal/concentration foundation — kept, wired into
`analyze.ts`), `cross-channel.ts` (comparability-gate pattern), `audience.ts` (protected-dimension
guard — reused so visual analysis never infers protected traits / identifies individuals); Phase 3
`timeline.ts` (change-point), `memory.ts`/`memory-store.ts` (creative memory), `outcomes.ts`
(outcome linkage); Phase 1 `ai-gateway.ts` (extended for multimodal). Deterministic-first, bilingual,
evidence-gated, currency/comparability-safe, causal-restraint — all carried forward.

## New persistent entities (one forward-only migration, RLS + revoke, tenant-scoped)

`markting_creatives`, `markting_creative_assets`, `markting_creative_analysis` (versioned),
`markting_creative_clusters`, `markting_creative_memberships`, `markting_creative_signals`.

## Workstream ledger (filled as built)

0 live blockers · 4A model · 4B ingestion · 4C performance · 4D lifecycle · 4E fatigue · 4F change-
point · 4G text · 4H hook · 4I angle · 4J visual · 4K video · 4L multimodal gateway · 4M hashing/dedup ·
4N clustering · 4O winner/loser · 4P comparability · 4Q contribution · 4R recommendations · 4S test
ideas · 4T creative memory · 4U outcome linkage · 4V library · 4W detail · 4X dashboard · 4Y ask ·
4Z brief · injection defense · cost control · versioning · provider matrix · eval 4.0 · red team.
