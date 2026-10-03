# Phase 2 — Baseline

Branch `claude/amazing-heisenberg-0unnak`. Phase 1 exit `3e91494`. Phase 0 exit `e6fbd0c`.

Phase 2 turns the Phase-1 primitives (canonical model, deterministic analysis, data-trust, governed
model gateway, usage/cost controls, read-only capability, context builder, thread serialization,
evaluation framework) into a **senior media-buyer intelligence system**:

```
DATA → ANALYSIS → DIAGNOSIS → RECOMMENDATION → RISK → PREVIEW → HUMAN APPROVAL → WRITE
```

Phase 2 owns **DATA → ANALYSIS → DIAGNOSIS → RECOMMENDATION**. It does **not** enable autonomous
provider mutations. The AI remains technically unable to write in READ_ONLY / LIVE_RECOMMENDATIONS
(enforced at the tool registry, Phase 1B). A recommendation is a structured, evidence-backed artifact;
accepting one does **not** mutate provider state — only the Phase-0 governed preview/apply path can.

## Environment reality (what can and cannot be proven here)

Verified at baseline by inspecting the sandbox:

| Capability | State | Consequence for Phase 2 |
|---|---|---|
| GitHub Actions runner | AVAILABLE (workflow_dispatch) | Root CI triggered on this branch for real execution proof (Workstream 0.1). |
| Live provider OAuth creds (Meta/Google/TikTok/Snapchat) | NOT PRESENT (no env secrets) | Live transport unverified; 0.2 falls back to sanitized replayable fixtures captured at the adapter boundary, documented as UNVERIFIED_LIVE_TRANSPORT. Never fabricate a live test. |
| Supabase / Postgres locally | DOWN (Docker unavailable) | DB-gated suites run only in the CI `cloud-db` lane; locally classified CODE_COMPLETE, not RUNTIME_PROVEN. |

So every claim below is tagged honestly: **CODE_COMPLETE** (built + unit-proven against typed
boundaries + synthetic data), **RUNTIME_PROVEN** (executed against a real runtime), or
**BLOCKED_EXTERNAL** (needs infra/creds absent here).

## What Phase 1 already gives us (built on, not rebuilt)

- `lib/markting/intelligence/model.ts` — `MetricObservation`, `CanonicalEntityRef`, canonical metrics.
- `lib/markting/intelligence/normalize.ts` — provider `ReportRow` → `MetricObservation` with trust.
- `lib/markting/intelligence/analysis.ts` — aggregate / comparePeriods / funnelDecomposition /
  budgetPacing / anomalyDetection (MAD) / campaignContribution — currency-safe, evidence-gated.
- `lib/markting/intelligence/context.ts` — bounded context builder.
- `lib/markting/data-trust.ts` — `evaluateEvidence`, tiers, staleness, INSUFFICIENT_EVIDENCE.
- `lib/markting/ai-gateway.ts` + `usage-ledger.ts` — governed model gateway + idempotent cost ledger.
- `lib/markting/engine-context.ts` — server-derived tenant identity + read-only mode.
- `lib/markting/business-context.ts` — targets with KNOWN/CONFIGURED/DERIVED/UNKNOWN provenance.

## Design rules held throughout Phase 2

1. **Deterministic first.** Code detects signals, diagnoses, computes contribution, risk, confidence,
   and expected-impact direction. The LLM narrates structured findings; it never invents numbers,
   confidence, or impact.
2. **Evidence or silence.** Every surfaced finding carries machine-readable evidence references; a
   finding without sufficient evidence resolves to INSUFFICIENT_EVIDENCE, not a guess.
3. **No second action path.** Recommendations cannot carry an arbitrary endpoint/path/body. They name
   a typed review category only; execution stays on the Phase-0 policy-engine preview/apply path.
4. **Untrusted ad content.** Campaign names, ad copy, creative metadata, URLs, report fields are DATA,
   never instructions. Structured context separates data from system instructions; adversarial tests
   cover injection in each field.
5. **Comparability gated.** Cross-period, cross-campaign, and cross-channel comparisons validate
   currency / attribution / window / timezone / trust before comparing, else NOT_COMPARABLE.
6. **Tenant-scoped, forward-only.** All new persistent state is org-scoped with ownership constraints
   and forward-only migrations, with DB-backed isolation tests (run in the CI DB lane).

## Workstream ledger (filled as built)

0.1 CI proof · 0.2 live/fixture read · 0.3 production caller · 2A decision model · 2B diagnostics ·
2C contribution · 2D health · 2E pacing · 2F scaling · 2G downscale · 2H anomaly · 2I trend ·
2J forecast · 2K targets · 2L creative · 2M audience · 2N cross-campaign · 2O cross-channel ·
2P recommendation engine · 2Q confidence · 2R risk · 2S impact · 2T opportunity center ·
2U morning brief · 2V ask · 2W explainability · 2X history · 2Y notifications · 2Z provider parity ·
commerce contract · security/injection · evaluation 2.0 · media-buyer red team.
