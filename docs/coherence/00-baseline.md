# 00 — Coherence Program Baseline

**Branch:** `claude/amazing-heisenberg-0unnak` · **Start HEAD:** `1fdc9cd` (post-reassessment).
**Authoritative problem statement:** `docs/reassessment/00-executive-summary.md` … `15-final-council.md`.

## The problem this program addresses

The reassessment proved, nine times independently: MARKTING-AI had a strong governance/write-safety
spine and a large, well-tested intelligence estate, but the intelligence subsystems were **imported by
zero `app/` files** and disconnected from each other and from the live Assistant (a scripted demo).
Benchmark at baseline: **8/50 media-buyer questions answerable now.**

## What this program does (and does not do)

It turns the EXISTING capabilities into one coherent, reachable product — **reachability before new
depth**. It does not build a new phase of isolated capabilities, does not enable autonomous optimization
or Mode-B provider writes, and does not fabricate live validation. No live provider/model/commerce
credentials exist in this environment; anything requiring them is `BLOCKED_EXTERNAL` and demonstrated on
clearly-synthetic demo data instead.

## Honest status model

Every item in these docs and the exit report is tagged:
- **DONE** — implemented, typechecked, unit-tested, and CI-green on real Postgres where relevant.
- **PARTIAL** — a real, tested slice exists; more remains (named explicitly).
- **NOT_STARTED** — not built this program; the plan is recorded.
- **BLOCKED_EXTERNAL** — needs credentials/infrastructure absent here; never faked.

This is a large multi-program mandate; this document set records exactly what was completed vs. what
remains, with evidence, rather than claiming the whole program is finished.

## Waves completed (summary — detail in the per-area docs and the implementation log)

- **Wave 0 (Program 0) — DONE, CI-green:** closed the Phase-1 RLS security P0.
- **Wave 1 (Program 1) — DONE, CI-green:** canonical money/trust/recommendation at the boundary + the
  unified `MarketingIntelligenceOrchestrator`.
- **Wave 2 (Program 17) — DONE, CI-green:** four material data-science corrections before surfacing.
- **Wave 3 (Programs 2/3/4/6 core) — DONE, build+suite green:** orchestrator-backed Assistant service
  with an honest answer-source, and two reachable surfaces (Needs Attention, Recommendation Center).
- **Program 23 — PARTIAL:** 12 cross-domain golden cases (of the 20 named).
- **Waves 4–7 remainder** (dedicated account/creative/commerce/experiment/agency/executive pages, IA
  redesign, Playwright E2E, AI-eval harness, provider contract-replay tests, scale refactors) —
  **PARTIAL/NOT_STARTED**, recorded honestly per area.

See `PRODUCT-COHERENCE-EXIT-REPORT.md` for the consolidated status and the 40-item return.
