# 10 — Data-quality depth, usage/AI-cost, kill-switch/policy visibility (Programs 28–30)

## Data-quality UI depth (Program 28) — `807fb3f`
The **Data Quality Center** (`app/dashboard/data-quality/page.tsx` → `buildDataQuality`) now surfaces,
with severity + code as a text label (status by label, not color-alone):
`STALE_SYNC`, `MISSING_COGS`, `ATTRIBUTION_MISMATCH`, `MIXED_CURRENCY`, and the provider schema-drift
states `UNSUPPORTED_FIELD` / `MISSING_REQUIRED_DATA` (CRITICAL) / `PROVIDER_SCHEMA_CHANGED` (CRITICAL).
These are data problems kept distinct from business-performance problems (see doc 05).

## Usage / AI-cost (Program 29) — `<this batch>`
Backend was already complete: `lib/markting/usage-ledger.ts` records every AI call
(`estimatedCostMicros`, token counts, status) and `ai-gateway.ts` meters + quota-enforces it. The gap
was **no user-facing surface**. Closed with a **read-only** panel on the new Governance surface
(`app/dashboard/governance/page.tsx`) that shows the AI-usage budget (window / max requests / max cost)
and states that per-organization live consumption is recorded server-side and appears on a connected
deployment. No new mutation path; no fabricated demo numbers.

## Kill-switch / policy read-only visibility (Program 30) — `<this batch>`
Backend governance existed with no visibility: `lib/markting/ops/kill-switch.ts` (5 scopes, fail-closed)
and `runtime-mode.ts` / `ops/mode-a.ts` (the mode ladder + capability matrix). The **Governance**
surface now renders, **read-only**:
- the resolved **runtime mode** and the full ladder (with the fact that no autonomous-write mode exists
  — autonomous provider writes cannot be expressed in the type, so no config can enable them);
- the **Mode-A/B capability matrix** (read / recommend / preview / apply) for the current mode, with
  "autonomous optimization is disabled" and "writes held" / "writes possible (approval-gated)";
- the **kill-switch enforcement model** (scopes, fail-closed), with active per-org switches shown only on
  a connected deployment and never fabricated in demo.

The existing `policies` page keeps its guarded policy editor; the Governance surface adds **no** new
mutation — switches are still only set through the governed change-management path, not from the UI.
