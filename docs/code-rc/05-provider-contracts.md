# 05 — Provider contract completion + fuzz (Programs 22–23)

## Coverage (code-solvable, without live credentials)
| Provider | Contract/replay | Normalization fuzz | Fixture label |
|---|---|---|---|
| Meta | `meta-contract.test.ts` — pagination, nulls, drift, error envelope | within contract suite | DOCUMENTATION_DERIVED / SYNTHETIC |
| Google | `google-contract.test.ts` — nextPageToken, missing fields, drift, error | within contract suite | DOCUMENTATION_DERIVED / SYNTHETIC |
| TikTok | `tiktok-contract.test.ts` (new) — happy shape, error envelope (HTTP 200 code≠0) | missing/zero/huge values, unknown fields, empty list | DOCUMENTATION_DERIVED / SYNTHETIC |
| Snapchat | `snapchat.test.ts` — breakdown normalization, malformed-breakdown → PROVIDER_ERROR, truncation | missing-metric **preservation** (no implicit zero) already covered | SYNTHETIC |

## Property guarantees (Program 23)
Every adapter's report normalization fails safe: a missing/zero/huge/malformed value never yields NaN or
Infinity; a guarded ratio with a zero denominator is `0`, and an UNKNOWN metric is **omitted, never
substituted with 0**. Unknown/extra response fields (schema drift) are ignored, not fatal. Snapchat
additionally validates with Zod schemas, so malformed shapes reject deterministically.

## Fixture honesty
All fixtures are labelled `DOCUMENTATION_DERIVED` (shaped to the providers' published API docs) or
`SYNTHETIC`. **No fixture is labelled `LIVE_CAPTURED`** because no live capture was performed.

## Honest status / external blocker
Gate "provider contract/replay tests pass": GREEN for the code-solvable contract + fuzz layer across
Meta, Google, TikTok, Snapchat. A **live-captured cassette** suite for each provider remains the
outstanding EXTERNAL task — it needs real provider credentials, which are BLOCKED_EXTERNAL here.
