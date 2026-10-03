# 05 — COGS, Margin & Profit (5K/5L/5Y)

`profit.ts`.

## COGS (5K)

Cost comes only from a trusted source: merchant-configured product cost, an ERP/feed, or an explicit
import. Every `CostObservation` carries provenance → trust (`merchant_config` → COST_CONFIGURED,
`erp_feed` → COST_CONFIGURED + COST_VERIFIED). **COGS is NEVER inferred from selling price. Unknown cost
stays UNKNOWN (undefined), never 0.** `CostBook` resolves unit cost by sku/variant/product;
`orderCogs` returns a total ONLY when **every** line's cost is known (partial COGS is not a trusted
total — it returns `null`).

## Margin (5L)

`computeMargin` returns gross profit + gross margin % (requires COGS) and contribution profit +
contribution margin % under an **org-configurable** `ContributionConfig` that declares which costs
count (COGS, payment fees, shipping, fulfillment, discounts, ad spend). The result lists the included
`contributionComponents` so a number is never mistaken for a different definition. If COGS is unknown,
or cost components are in a different currency than revenue, it returns `notComputableReason` rather
than a fabricated figure.

## Break-even ROAS (5Y)

`breakEvenRoas` = `1 / contribution-margin-fraction`, and ONLY when a trusted contribution margin that
**excludes ad spend** exists; otherwise `BREAK_EVEN_UNKNOWN` (never invented). A non-positive
contribution margin yields `BREAK_EVEN_UNKNOWN` (no finite break-even). The methodology string is
attached; different contribution structures therefore produce different break-even ROAS, not one
oversimplified formula.

`profitComputability` is the guard used before any profit surface: profit is valid only on
merchant-sourced, single-currency revenue with known COGS.
