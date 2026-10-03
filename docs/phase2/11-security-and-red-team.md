# 11 — Security & Red-Team

## Security posture

- **Dependency vulnerabilities (Workstream 0.1 / 1R):** CI `pnpm audit --prod --audit-level high` is
  clean. Fixed: 3 critical Next.js RCE advisories (bump 16.3.1 → 16.3.8) and the transitive highs
  (`fast-uri ^3.1.7`, `sharp ≥0.35.4` via `pnpm-workspace.yaml` overrides). 10 moderate remain (below
  the gate), carried as a known item. The audit gate itself was not weakened.
- **Secret scanning:** gitleaks runs in CI with the full default ruleset; a root `.gitleaks.toml`
  allowlists only test directories (synthetic fixtures), so production source/infra/config are fully
  scanned.
- **Prompt injection / untrusted content:** campaign names, ad copy, creative text, URLs, and report
  fields are treated as DATA. The deterministic engines select entities by numbers; injected text can
  appear only in a `name`/`copy` field, never as a control value (org, action, category, tool). Org
  identity is server-derived from the authenticated principal. Covered by `test/phase2-injection.test.ts`.
- **No second write path:** a `Recommendation` carries only a typed category + review action + evidence;
  no endpoint/path/body. Accepting a recommendation only changes its status. The sole route to a
  provider mutation remains the Phase-0 human-approved preview/apply path, and the AI is read-only in
  LIVE_READ_ONLY / LIVE_RECOMMENDATIONS (registry gate). Covered by `test/phase2-safety.test.ts`.

## Media-buyer expert red-team (independent)

An independent adversarial panel (Meta/Google/TikTok/Snapchat buyers, performance lead, attribution
scientist, analytics engineer, AI evaluator, security engineer, SaaS architect) reviewed the engines
and the production orchestrator against synthetic scenarios. Verdict: the deterministic math,
evidence gating, confidence/risk orthogonality, comparability gate, and the no-second-write-path
invariant HOLD; the serious issues were in the orchestrator wiring and two loose gates. **All BROKEN
and PARTIAL findings were fixed and locked with regression tests** (`test/phase2-redteam-fixes.test.ts`).

| # | Finding | Rank | Resolution |
|---|---|---|---|
| 1 | Scaling reachable with no performance evidence; a scale rec could cite a deterioration | BROKEN | `scaling.ts` now requires BEATING a known target to be READY (volume alone → NOT_READY); `analyze.ts` passes real `fresh`/`recentlyStable`/attribution (no hardcoded flags); `recommendation.ts` never cites a deterioration diagnosis for a scale rec |
| 2 | Funnel/anomaly/trend engines not wired into the single path | BROKEN | `diagnoseEntity` now emits `FUNNEL_STAGE_COLLAPSE`; `analyzeAccount` runs anomaly + trend (from an optional daily series) and emits `ANOMALY`; trend feeds `recentlyStable` |
| 3 | Cross-channel unknown currency slipped through as COMPARABLE | PARTIAL | unknown currency is now a soft difference (→ PARTIALLY_COMPARABLE), and a hard blocker for a currency-denominated CPA ranking (→ NOT_COMPARABLE) |
| 4 | "Driven mostly by" could name an offsetting factor | PARTIAL | factor selection (text + stored drivers) now restricted to factors pushing the metric in its observed direction |
| 5 | Overreaction: zero-conv CRITICAL / volume-decline ATTENTION on partial windows; materiality ignored confidence/trust | PARTIAL | zero-conv is WATCH (not CRITICAL) on an open window; volume declines soften to WATCH when incomplete; Opportunity-Center materiality now discounts low confidence + low trust |
| 6 | Health `conversion_quality` always HEALTHY; fatigue/attribution dims dropped | PARTIAL | `analyzeAccount` now threads `conversionRateWorsening`, `attributionConsistent`, and `creativeFatigueSignal` into `assessHealth` |

Notes also addressed: the anomaly day-of-week seasonal factor is clamped to [0.25, 4] so a low-volume
weekday cannot manufacture a false spike; and `runAssistantTurn` now asserts `canPreview(mode)` before
bridging a write proposal (defense-in-depth on top of the registry read-only gate).

Items confirmed HOLD by the panel: log-ratio decomposition correctness + currency-safety; both-window
evidence gating; confidence caps (lowest factor) and risk orthogonality; recommendation has no
endpoint/path/body; `ACCEPTED_FOR_PREVIEW` only flips status; `INSUFFICIENT_EVIDENCE` cannot transition
to accept; org identity server-derived; underpacing never routed to scale; low spend never "poor".

## Residual / deferred

- 10 moderate dependency advisories (below the high gate).
- Pre-existing audit P2/P3 items carried from Phase 0/1 (MCP refresh-token revocation cascade, Stripe
  webhook ordering, CSRF tokens, DB-level RLS backstop, encryption-key rotation) — out of Phase-2 scope.
- Live-model prompt-assembly hardening will need its own injection review once a model is wired (the
  structured context already separates data from instructions).
