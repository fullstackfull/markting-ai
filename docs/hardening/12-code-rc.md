# 12 — Persona walkthroughs, independent review, CODE-RC gate (Programs 38–40)

## Program 38 — persona walkthroughs (5)

Each walkthrough is traced against shipped surfaces + the executable benchmark/E2E, not aspiration.

1. **Solo performance marketer (daily review).** Workspace → account → campaign drill-down → creative
   detail → experiment. Pacing/trend/scaling/forecast all composed from real engines; forecast shows
   method + band + limitations. Benchmark #1–#14, #32–#41, #48–#50. E2E-01 authored.
2. **E-commerce / commerce owner.** Commerce surface: net revenue, refund rate, MER, contribution
   margin (UNKNOWN when COGS missing — never inferred), platform-vs-merchant reconciliation. Benchmark
   #6, #15, #16. E2E-03 authored.
3. **Creative strategist.** Creative library → creative detail → fatigue evidence → test idea;
   `MULTIMODAL_NOT_CONFIGURED` is honest. Benchmark #7, #19, #20, #50. E2E-02 authored.
4. **Agency lead (multi-client).** Agency portfolio attention queue (ranked by real signals, no currency
   blend) → client switch (navigation-based, no cross-client leakage) → per-client account. Benchmark
   #18, #38. E2E-04 authored.
5. **Operator / governance owner.** Governance surface: runtime mode, write-capability matrix (writes
   held, autonomous disabled), AI-usage budget, kill-switch enforcement — all read-only. Policies page
   for guarded policy edits. Benchmark #44–#47.

## Program 39 — independent review (13 reviewer lenses)

A structured self-review across 13 lenses; each is a claim + the evidence that backs it.

1. **Correctness** — engines composed deterministically; 767 non-DB tests pass.
2. **Honesty** — benchmark 42/50 with every not-now classified; no faked intents.
3. **Trust/grounding** — every factor carries a data-trust tier; tier = weakest source (AI-eval S08/S37/S50).
4. **Security** — AI cannot write; injection treated as data; RLS isolation (doc 11).
5. **Commerce truth** — profit UNKNOWN without COGS; platform value ≠ merchant revenue.
6. **Ratio safety** — zero-denom/missing/mixed-currency/incompatible-period → UNKNOWN (doc 07).
7. **Forecast honesty** — method/window/horizon/band/limitations surfaced (doc 07).
8. **Providers** — Meta + Google contract/replay edges tested; live cassettes outstanding (doc 05).
9. **Accessibility** — text-first status, chart summaries, RTL; no axe CI lane (doc 03).
10. **Data-viz** — one axis, identity never color-alone, status reserved (doc 02).
11. **Scale** — in-memory < 5 s @ 10k + bounded gatherer + AI quota; DB-path refactor outstanding (doc 06).
12. **Architecture** — one orchestrator, one design kit, no dead routes (doc 11).
13. **Governance** — writes held, autonomous impossible by type, visible read-only (doc 10).

Findings carried as explicit PARTIAL gates (not hidden): browser E2E (authed journeys need a seeded
session), provider replay (live cassettes), accessibility CI, DB-path scale, CI security-as-a-lane.

## Program 40 — RELEASE-CANDIDATE CODE GATE ("CODE-RC")

**Verdict: CODE-RC — the code is coherent, tested, and honest; it is NOT production-ready.**

- GREEN: unified product (orchestrator + surfaces), security P0 fixed, benchmark 42/50 honest, AI-eval
  50/50, forecast + ratio + commerce honesty, design kit + status semantics, data-quality + governance
  visibility, real browser E2E foundation (public live), CI green across the branch.
- PARTIAL / outstanding for production go-live (all require live credentials or a backend refactor, both
  out of this program's scope): authed E2E journeys (seeded session), live-captured provider cassettes,
  a DB query-path scale refactor, an automated accessibility lane, and a dedicated CI security-scan lane.
- HELD by design: Mode B provider writes, autonomous optimization. No new mutation path was added.

CODE-RC means: safe to review, demo, and integrate against; a human must still connect live providers,
capture real cassettes, and sign off before any live write.
