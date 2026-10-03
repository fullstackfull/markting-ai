# 09 — AI Evaluation 5.0

`test/phase5-eval.test.ts` — 30 commerce scenarios scored for arithmetic correctness, revenue-basis
correctness, margin correctness, refund handling, uncertainty, attribution restraint, PII safety,
tenant isolation, and bilingual quality. All pass (plus supporting assertions).

| # | Scenario | Asserted |
|---|----------|----------|
| 1 | Platform ROAS high, merchant revenue low | reconciliation → MATERIAL_VARIANCE, platform > merchant |
| 2 | Refunds reduce net revenue | net = gross − refund |
| 3 | High revenue, poor margin | gross margin ≈ 5% |
| 4 | Low revenue, strong contribution margin | CM% > 70 |
| 5 | Mixed currencies | not blended (mixedCurrency, no total) |
| 6 | Cancelled orders | excluded from paid basis |
| 7 | Failed payment | excluded |
| 8 | Partial refund | counted as partial |
| 9 | Duplicate order | flagged + excluded |
| 10 | Duplicate sync | idempotent (no double count) |
| 11 | Missing COGS | margin not computable (never 0) |
| 12 | Break-even unknown | BREAK_EVEN_UNKNOWN |
| 13 | Identity insufficient for CAC | refused (UNKNOWN) |
| 14 | Repeat customer | returning |
| 15 | New customer | new |
| 16 | Attribution mismatch | UTM = last-touch, click id = directly-tagged |
| 17 | Timezones/windows | explicit basis carried |
| 18 | Late refund | reduces net (refund records counted) |
| 19 | Promotion / gross vs net basis | gross basis > net basis |
| 20 | Missing UTM | unattributed/unknown |
| 21 | Modelled platform conversions | explanation lists modelling |
| 22 | Merchant > platform revenue | positive difference |
| 23 | Platform > merchant revenue | negative difference |
| 24 | High MER but poor profit | MER computes; margin withheld (no COGS) |
| 25 | Good ROAS but bad refunds | refund rate by value computed |
| 26 | Prompt injection in order note | never reaches analytics-safe projection |
| 27 | PII redaction | email/phone/address/notes dropped; pseudonym stable + tenant-scoped |
| 28 | Cross-tenant order write | rejected before DB |
| 29 | Arabic commerce answer | cites basis bilingually |
| 30 | English MER answer | cites basis + scope |

Supporting: cross-currency compare refuses without governed FX; profit-computability guard; observed
LTV labelled `OBSERVED_LTV`; `orderCogs` null on any unknown line; profit brief separates platform vs
merchant; break-even known from a trusted CM. `phase5-commerce.test.ts` covers connector normalizers,
the sync engine (idempotent/checkpointed/dead-lettered/bounded), webhooks (signature/dedup/replay/
connection-mapped org), product/SKU intelligence, inventory-risk, promotion partitioning,
creative×commerce caveat, and review-only recommendations. `phase5-commerce.database.test.ts` proves
tenant isolation, idempotent order upsert, refund scoping, cost-book load, sync-checkpoint resume,
webhook dedup, and config history on a real Postgres (CI `cloud-db` lane).
