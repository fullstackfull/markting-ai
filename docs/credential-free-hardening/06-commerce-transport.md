# 06 — Commerce transport abstraction + replay contracts (items 11, 12)

`lib/markting/commerce/transport.ts`, `lib/markting/commerce/replay-contracts.ts` +
`test/commerce-transport.test.ts`, `test/commerce-replay.test.ts`.

## Transport abstraction (item 11)

A `CommerceTransport` port sits **under** the existing read-only `CommerceConnector` contract and isolates
the wire concern for Shopify / WooCommerce / Salla / Zid: an authenticated `TransportRequest` → a
`TransportPage` of raw records.

- **Read-only by construction** — the request has no verb/body field and `resource` is a closed union
  (`COMMERCE_READ_RESOURCES`: stores/orders/products/refunds/inventory); `isReadResource()` rejects
  anything else. No mutating verb is representable.
- `FakeCommerceTransport` — in-memory fixtures, deterministic cursor paging, classification
  `FIXTURE_PROVEN`.
- `BlockedHttpCommerceTransport` — implements the port, ships **no** network client, throws a
  `BlockedExternalError` (carrying `BLOCKED_EXTERNAL_MARKER`); `fetchPage` never performs a call.
- `COMMERCE_TRANSPORT_DESCRIPTORS` — per-platform DOCUMENTATION_DERIVED metadata (base-path shape with
  `{resource}`/`{version}` placeholders, pagination style reusing `PageStyle`, auth header **name** only —
  no secret values).
- `transportPageSource()` adapts a transport into a `PageSource` so `paginate` (doc 02) drives traversal.

## Replay contracts (item 12)

`REPLAY_CONTRACTS`: deterministic captured-sample → expected-canonical-entity mappings for all four
platforms (`FIXTURE_PROVEN`). `runReplayContract()` runs the **real** provider normalizer over each
captured sample; `checkReplayContract()` asserts the mapping into canonical `Order`/`Product`/`Refund`
(ids, currency, stage, payment/fulfillment status, minor-unit amounts, line count, sku, refund kind) —
with no live store.

`assertMerchantTruthOnly()` is the explicit **merchant-truth-only** invariant: every captured order carries
a planted `ad_conversion_value` in `raw` that differs from the merchant total, and the helper throws
`MERCHANT_TRUTH_VIOLATION` if any gross/subtotal reflects the ad value, if any line infers COGS, or if net
revenue is computed without an explicit basis. Negative self-tests confirm it fails on each violation path.
