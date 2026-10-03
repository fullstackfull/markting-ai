# 08 — Cross-Campaign & Cross-Channel Intelligence (2N / 2O)

## Cross-campaign (2N) — `intelligence/cross-campaign.ts`

Analyzes the account as a portfolio, not campaigns in isolation:

- **Spend concentration** (Herfindahl index → DIVERSE/MODERATE/CONCENTRATED) and top spenders.
- **Budget fragmentation** (many low-delivery campaigns alongside active ones).
- **Inactive / low-delivery inventory** (campaigns below a spend-share floor).
- **Cannibalization / overlapping roles** — only ever raised as a `POSSIBLE_NEEDS_PROVIDER_PROOF`
  SIGNAL (from a weak name-root heuristic). Actual audience overlap is **never asserted** from metrics;
  it requires provider audience/placement data to confirm.

Currency-aware (mixed currency is flagged, not blended).

## Cross-channel (2O) — `intelligence/cross-channel.ts`

The safety-critical gate against fake cross-platform winners. Before ANY provider-vs-provider
comparison, `checkComparability` validates currency, attribution basis, conversion definition,
timezone, date-range overlap, and trust tier, returning `COMPARABLE / PARTIALLY_COMPARABLE /
NOT_COMPARABLE` with the matched/differed dimensions spelled out.

`compareChannels` produces a ranking **only** when the gate allows it, and attaches a caveat
("indicative, not definitive" for PARTIALLY_COMPARABLE). Hard blockers — different currency, no
date overlap, or a synthetic/unverified channel — force `NOT_COMPARABLE` and **no ranking is
produced**. ROAS/CPA are never summed across channels. This is why "Compare Google and Meta" in the
Ask surface answers only when the data is comparable, and otherwise explains the gate.
