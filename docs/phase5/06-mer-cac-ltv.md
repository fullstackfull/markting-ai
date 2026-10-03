# 06 — MER, CAC & LTV Foundation (5M/5N/5O/5P)

`metrics.ts`.

## MER (5M)

`MER = merchant revenue / total ad spend`, but the revenue **basis is always explicit**. `computeMER`
returns `{ basis: gross|net|contribution, value, revenue, adSpend, adSpendScope, window, currency,
mixedCurrency, trust }`. Different bases are never all called "MER" without qualification. MER is
`notComputable` on mixed currency (no governed FX) or zero/unknown ad spend.

## Customer identity (5O)

`CustomerReference` uses a tenant-scoped **pseudo-id** (HMAC of a normalized identifier with a per-org
key; see `pii.ts#pseudonymize`), never raw email/phone as the analytics key, and never cross-tenant.
`classifyCustomer` returns new/returning only when identity is reliable; an anonymous order stays
`unknown` — the system never pretends to know new vs returning.

## Blended CAC (5N)

`blendedCAC = ad spend / identified new customers`, computed ONLY when a sufficient share of orders
carry reliable identity (`minKnownShare`, default 50%). Below that it returns reliability `UNKNOWN` and
refuses the number. Reliability is surfaced (`KNOWN` / `PARTIAL` / `UNKNOWN`).

## Observed LTV (5P)

`observedLTV` computes **observed** 30/60/90-day revenue-per-customer, orders-per-customer, repeat
purchase rate, and AOV from a cohort's orders — only where identity supports it. It is labelled
`OBSERVED_LTV`, **never `PREDICTED_LTV`** (predictive LTV ML is deferred to a later phase). Single
currency only.
