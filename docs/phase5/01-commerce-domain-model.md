# 01 — Canonical Commerce Domain Model (5A)

`lib/markting/commerce/model.ts`. One canonical model all providers map into; provider-specific fields
live in each entity's `raw` bag so normalization is never lossy. Source-system ids and the source
platform are preserved.

## Entities

- **Store / StoreConnection** — a store and its authenticated, tenant-scoped connection. The connection
  holds an opaque `credentialRef` (a secret *reference*), **never** the secret itself.
- **Product / Variant** — catalog, with preserved external ids and `raw`.
- **Order** — `organizationId, workspaceId, storeId, platform, externalOrderId, orderNumber, createdAt,
  paidAt, fulfilledAt, cancelledAt, currency, subtotal, discountTotal, taxTotal, shippingTotal,
  grossTotal, refundedTotal, netRevenue, stage, paymentStatus, fulfillmentStatus, customer, acquisition,
  lines, provenance, raw`.
- **OrderLine** — `productId, variantId, sku, quantity, unitPrice, discountAllocated, taxAllocated,
  netRevenue, cogs (UNKNOWN = undefined, never 0), raw`.
- **Refund** — `amount, kind (full|partial), refundedAt, reason, lineRefs, provenance`.
- **CustomerReference** — a tenant-scoped **pseudo-id** (never raw email/phone) + `classification`
  (new|returning|unknown) + `identityConfidence` (KNOWN|PARTIAL|UNKNOWN).
- **AcquisitionRef** — UTM fields, hashed provider click ids, referrer, landing page, `anonymous`.
- **CostObservation** — per-unit cost with provenance (merchant_config / erp_feed / manual_import) and
  effective dates. Never inferred from price.
- **RevenueObservation / MarginObservation** — computed figures carrying an **explicit basis** /
  contribution components, so a number is never mistaken for a different definition.

## Money rules

`CommerceMoney = { minorUnits: integer, currency }`, mirroring `@adport/core` Money. **No float
currency arithmetic.** `addMoney`/`subMoney`/`mulMoney` throw on a currency mismatch; `sumMoney`
returns `null` (not 0) if a list mixes currencies. Payment and fulfillment status are explicit enums;
`OrderStage` (placed/paid/fulfilled/cancelled/failed/refunded/partially_refunded) is distinct from them
and decides the revenue basis.

## Trust

Deterministic commerce tiers (`trust.ts`): `PLATFORM_ORDER, PAID_ORDER, FULFILLED_ORDER,
REFUND_VERIFIED, COST_CONFIGURED, COST_VERIFIED, CUSTOMER_ID_PARTIAL`. Trust is derived from facts
(paid/fulfilled/refund/cost provenance), never asserted by a model or a payload. Profit math is only
"trustworthy" when a cost tier is present.
