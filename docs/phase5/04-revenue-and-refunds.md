# 04 — Business Revenue & Refunds (5J/5Q/5R)

`revenue.ts`. The terms are kept strictly distinct and **never mixed**.

## Definitions

- **Gross Sales** — line value before discounts/refunds.
- **Discounts**, **Refunds**, **Tax**, **Shipping** — tracked as their own figures.
- **Net Revenue** — computed under an **explicit, configured `RevenueBasis`**:
  `{ countStages, includeTax, includeShipping, deductRefunds, deductDiscounts, label }`.

Nothing is chosen silently. `DEFAULT_REVENUE_BASIS` = `net_paid_excl_tax_excl_shipping` (paid/fulfilled
orders, excl. tax & shipping, net of refunds + discounts). `GROSS_SALES_BASIS` exists for explicit
comparison, never as the default. Every `RevenueObservation` carries its `basis.label`, currency,
window, order count, and `mixedCurrency`.

## Order status (5R)

`computeRevenue` counts only orders whose `stage` is in `basis.countStages`. Cancelled / failed /
unpaid orders are excluded unless the basis explicitly counts their stage, so unpaid/cancelled volume
never inflates merchant revenue.

## Refund intelligence (5Q)

`refundIntelligence` returns refund rate by count and by value (undefined on mixed currency), full vs
partial counts, and net-after-refunds. Campaigns must be judged on net-after-refunds where refund data
exists — never on gross purchase value alone. Data-quality (`data-quality.ts`) fails **closed**: a
refund exceeding its order, a negative total, a duplicate order, a future timestamp, impossible
quantities, mixed-currency lines, or a missing currency **exclude** the order from trusted aggregates
rather than poisoning them.

## Currency

`computeRevenue` never blends currencies: a mixed-currency window returns `mixedCurrency: true` with
monetary totals held at the first currency's zero (the caller must not treat them as real numbers).
