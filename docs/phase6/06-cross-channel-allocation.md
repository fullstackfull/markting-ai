# 06 — Cross-Channel Allocation & FX (6Q + Governed FX)

## Comparability

Cross-campaign and cross-channel comparisons reuse the Phase-2/5 comparability gates: currency,
objective, funnel stage, business role, attribution, time window, and data trust must be sufficiently
aligned. Results are `COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE`; no fake universal ranking is
produced across non-comparable channels. Budget is never moved from a brand/strategic campaign to a
direct-response one purely on direct ROAS (role metadata is respected).

## Governed FX (`optimize/fx.ts`)

Cross-currency allocation stays BLOCKED unless a governed `FxRegistry` is supplied. Every conversion
records source + rate + timestamp + base currency; `convertToBase` refuses (NOT_COMPARABLE) without a
governed rate, and `crossCurrencyAllowed` blocks a mixed-currency allocation when any leg lacks a
governed rate. An LLM-provided FX rate is NEVER accepted. In this environment no governed source is
wired, so cross-currency allocation is **BLOCKED** (Gate E).
