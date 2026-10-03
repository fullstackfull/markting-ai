# 03 — Budget Allocation (6I–6U)

`optimize/constraints.ts`, `optimize/allocation.ts`.

## Questions answered (review-only)

- "If we had an extra N, where should it be reviewed for deployment?" → `allocateExtra`.
- "If budget must be reduced by X, where is the least-damaging reduction?" → `reduceBudget`.

Both return review MOVES (candidate, delta, from→to, confidence, flags, reasons). Nothing executes.

## Algorithm choice (documented)

A DETERMINISTIC GREEDY marginal-value allocator over candidates sorted by a transparent scale-priority
score, stepping in bounded increments and re-checking hard constraints at every step. Complexity is
O(N log N + steps) with a hard iteration guard — no brute-force over combinations, no premature LP/ML.
The problem shape (independent per-candidate caps/floors + a single shared budget pool + a monotone
priority) is exactly what greedy solves well and auditably; LP/convex was not justified.

## Inputs (6J)

Target attainment (beating a KNOWN target), scaling readiness, marginal response (within a curve's
validity range), contribution margin / MER (merchant truth), saturation, creative fatigue, inventory
risk, attribution strength, data trust, role. Unknown inputs stay UNKNOWN and lower confidence.

## Hard constraints (6K)

Org max budget, account caps, campaign min/max bounds, protected campaigns/accounts, min spend floors,
experiment exclusions, currency. Inviolable at every step; no recommendation overrides them or Phase-0
safety.

## Soft constraints (6L)

Conservative scaling, minimize volatility, favor profitable growth, favor acquisition volume, preserve
brand campaigns, maintain channel diversification. These reorder WITHIN the hard constraints; they never
breach one.

## Profit / creative / inventory / attribution / role awareness (6R–6U, 6P/6Q)

Profit-aware when merchant truth exists (contribution margin raises/lowers priority). Saturation and
weak attribution reduce confidence. Creative fatigue flags `BUDGET_HOLD_PENDING_CREATIVE_REFRESH_REVIEW`
and withholds budget rather than scaling blindly. Inventory risk flags `INVENTORY_CONSTRAINT_PRESENT`
and lowers confidence (never auto-reduces spend). Brand/strategic campaigns are not raided for higher
direct ROAS (role-aware). Cross-campaign/cross-channel comparisons are gated by comparability; mixed
currency is blocked without governed FX.
