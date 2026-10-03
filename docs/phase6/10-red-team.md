# 10 — Expert Red-Team

An independent panel (performance-marketing lead, media-buying director, experimentation scientist,
statistician, optimization engineer, e-commerce CFO, attribution scientist, security engineer, SaaS
architect, independent skeptic) reviewed the optimization system read-only.

## Verdict

The two highest-priority invariants are CLEAN: there is **no autonomous-execution / Phase-0 approval
bypass path anywhere**, and **cross-tenant isolation holds** (org server-derived + asserted before DB,
RLS on all tables, per-org keys). The panel found one BROKEN and several PARTIAL defects, all fixed with
regression tests before exit.

## Findings and dispositions

| # | Finding | Rank | Disposition |
|---|---------|------|-------------|
| 10 | `reduceBudget` ignored `experimentExcludedIds` → could cut a campaign mid-experiment (self-inflicted contamination) | **BROKEN** | **FIXED** — reduce now excludes experiment-excluded candidates (mirrors `receiveEligible`); regression added. |
| 9 | `orgMaxBudgetMinor` enforced per-candidate, not in aggregate → the org-wide cap could be breached across candidates | **PARTIAL** | **FIXED** — `allocateExtra` tracks a running org total and refuses any step that pushes the aggregate over the cap; regression proves a 300k request into 900k/1M caps at 100k moved. |
| 11 | Brand/strategic "never raided" was soft-only; without the soft flag they were cut first on low direct performance | **PARTIAL** | **FIXED** — brand/strategic are now STRUCTURALLY protected from reduction by default (opt-out via `preserveBrandCampaigns: false`); regression added. |
| 12 | Causal ceiling was reported but not clamped onto the outcome stance (latent, safe only by coincidence) | **PARTIAL** | **FIXED** — the VALID branch now clamps `causalStance` to the study's ceiling; observational/before-after can never report a stance above their ceiling. |
| 13 | STRONG saturation only down-weighted an UP_REVIEW; it did not hold the candidate out | **PARTIAL (by design)** | **FIXED** — STRONG saturation now flags `SCALE_HOLD_PENDING_SATURATION_REVIEW` and is held out of scaling, symmetric with creative fatigue. |
| 14 | Projection used the AVERAGE slope on a diminishing curve → optimistic bias near the top of the range | **PARTIAL** | **FIXED** — a diminishing-returns curve now exposes the conservative local (last-segment) marginal; projections no longer overstate incremental conversions. |

## Invariants verified as HOLDING (not assumed)

- **No execution:** no fetch/mutate/provider-write anywhere in `optimize/`; recommendations hard-code
  `requiresHumanApproval: true` with no endpoint/url/method/body; the workbench exposes
  `executionPath: 'phase0_preview_approval_only'`; `rollbackPlan.automatic` is literally `false`; a
  scenario decision records a `review_status` enum only — no provider mutation path exists.
- **Cross-tenant:** `saveExperiment` asserts the org before the DB call; all reads/writes key on the
  server-supplied org; RLS deny-all to `authenticated` + backend-only on all six tables.
- **DB grants (Phase-4 lesson):** every `ON CONFLICT DO UPDATE` writer has UPDATE; insert-only tables
  correctly get only `select, insert`. No gap — validated on the real-Postgres CI lane.
- **Causal honesty:** contaminated/invalidated experiments return NOT_ESTABLISHED regardless of the
  numbers; before/after ≤ TEMPORAL_ASSOCIATION, observational ≤ OBSERVATIONAL_ASSOCIATION.
- **Sample sufficiency:** a labelled, conservative approximation (drops the `(1−p)` factor, so it
  over-requires) floored at the 30-observation minimum — never an LLM-invented size, no false power.
- **Allocator mechanics:** budget conserved (`moved = amount − unallocated`), deterministic, bounded by
  an iteration guard (no combinatorial blowup), caps/floors re-checked every step, protected campaigns
  and fatigue/saturation HOLDs excluded.
- **FX:** an LLM-supplied rate is never accepted; cross-currency is blocked without a governed registry.

The panel's report is model output treated as findings to verify, not authority; each fix was validated
against the suite (`test/phase6-redteam-fixes.test.ts`).
