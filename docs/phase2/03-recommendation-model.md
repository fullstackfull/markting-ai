# 03 — Decision & Recommendation Model (2A / 2P / 2R / 2S / 2X)

## Decision model (2A) — `intelligence/decision-model.ts`

Structured, not free-form prose: `Signal`, `EvidenceRef`, `Diagnosis`, `Recommendation`, plus the
categorical enums for confidence/risk/impact and the health/scaling/trend/anomaly/comparability states.

**Safety invariant (enforced by construction + `test/phase2-safety.test.ts`):** a `Recommendation`
carries only a typed `category` (one of 9 review categories) + `actionType` (a REVIEW/INVESTIGATE
intent) + an `entityScope` + evidence. It has **no** endpoint, path, HTTP method, or request body —
nothing that could be a second write path. `requiresHumanApproval` is always `true`. The only route to
a provider mutation stays the Phase-0 human-approved preview/apply path.

## Recommendation engine (2P) — `intelligence/recommendation.ts`

Maps each diagnosis to a `{category, actionType}` using the dominant factor where relevant
(CPA↑ driven by CTR → `CREATIVE_REVIEW/REVIEW_CREATIVE_REFRESH`; by CVR → `FUNNEL_REVIEW`; by CPM →
`DELIVERY_REVIEW`). A scaling-ready campaign becomes a `BUDGET_REVIEW/REVIEW_BUDGET_SCALE` (never an
auto-scale); a strong downscale candidate becomes a `PAUSE_REVIEW/REVIEW_PAUSE`. Every recommendation
carries confidence (from the diagnosis), risk (2R), expected impact (2S), ≥1 alternative (always
including "keep observing"), a status, and an expiry.

Categories: `BUDGET_REVIEW, PAUSE_REVIEW, DELIVERY_REVIEW, TRACKING_REVIEW, CREATIVE_REVIEW,
TARGET_REVIEW, FUNNEL_REVIEW, ANOMALY_REVIEW, DATA_QUALITY_REVIEW`.
Statuses: `DRAFT, REVIEWABLE, INSUFFICIENT_EVIDENCE, DISMISSED, ACCEPTED_FOR_PREVIEW, EXPIRED`.

## Risk (2R) vs Confidence (2Q) — orthogonal

Risk = consequence of ACTING (`risk.ts`): base per action (investigate = LOW, scale/pause = HIGH),
escalated by converting-entity exposure, blast radius (account spend share), and strategic importance.
Confidence = how strongly evidence supports the diagnosis. A high-confidence diagnosis can carry HIGH
action risk (e.g. pausing a high-spend converting campaign).

## Expected impact (2S) — direction only

`impact.ts`: `POSITIVE_DIRECTION_EXPECTED | NEGATIVE_RISK_REDUCTION | UNCERTAIN | NOT_ESTIMATED`.
No fabricated "+23% ROAS". A quantitative range would require a deterministic calibrated basis the
system does not have, so it is never produced.

## Persistence & lifecycle (2X) — `recommendation-store.ts` + migration `20261005000000`

Tenant-scoped (`(organization_id, id)` composite key; every query org-filtered). Forward-only
migration. A `requires_human_approval = true` CHECK makes the invariant visible at the DB. Lifecycle
transitions are validated (illegal transitions rejected) and recorded in `markting_recommendation_events`
(created/reviewed/dismissed/accepted_for_preview/expired) — preparing Phase-3 outcome learning without
implementing it. **Accepting** a recommendation only moves it to `ACCEPTED_FOR_PREVIEW`; it does NOT
mutate provider state. Expiry sweeps stale recommendations. Tenant isolation + lifecycle proven in
`test/recommendation-store.database.test.ts` (DB-gated, runs in CI).
