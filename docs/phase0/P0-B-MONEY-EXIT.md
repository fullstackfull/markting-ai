# P0-B Exit — Money & currency integrity (R0-04)

Status: **COMPLETE** for the write path and the dashboard overview. The engine's internal fixture
analytics (Python, byte-identical) are USD-only and out of the TS write-path scope; noted below.

## Canonical representation
`platform/packages/core/src/money.ts` defines `Money { currency, minor, exponent }` and the single
source of truth `CURRENCY_EXPONENTS`: 2-decimal (USD, EUR, GBP, SAR, AED, QAR, …), 0-decimal
(JPY, KRW, CLP, ISK, HUF, TWD, VND, …), 3-decimal (KWD, BHD, OMR, JOD, TND, …). Conversions are
explicit and currency-aware: `minorUnitsToMicros(minor, ccy) = minor × 10^(6−exponent)` and the
inverse `microsToMinorUnits`. An **unknown currency fails closed** (throws) rather than assuming two
decimals. No provider or the bridge may hard-code a factor.

## The bug and the fix
Only **Meta** was broken: `CENTS_TO_MICROS = 10_000` and the bridge's `Math.round(micros/10_000)`
hard-coded two decimals, 100×-inflating JPY/KRW and 10×-understating KWD. Fixed in:
- `platform/packages/meta/src/provider.ts`: typed budget writes (set/lifetime/create) fetch the
  account currency (`act_<id>?fields=currency`) and convert via `minorUnitsToMicros`; every budget
  delta now carries `currency`. The gated generic api_create collector keeps the 2-decimal estimate
  with a comment (it is disabled on the sanctioned path).
- `platform/apps/cloud/lib/markting/translate.ts`: the Meta case converts micros→minor units with the
  alias currency and **fails closed** (`unsupported`) if the alias has no currency.

All other providers are decimal-agnostic (micros-native pass-through, or whole-unit ×1e6) and were
verified correct.

## Aggregation
`platform/apps/cloud/app/dashboard/live-data.tsx` no longer sums spend or blends ROAS across
currencies: counts (impressions/clicks/conversions) sum freely; money is grouped by currency and a
blended ROAS is suppressed (`—`) when more than one currency is present. No FX rate is ever invented.
The core `report-summary.ts` path was already currency-grouped.

## Policy engine
The percent cap is ratio-safe (same-entity from/to). With Meta corrected, the micros scale is uniform
across providers so the absolute `max_daily_budget_micros` cap is meaningful; it is re-checked at
apply against a fresh preview (R0-06).

## Tests
core/money.test.ts proves USD/EUR/GBP/SAR/AED=×10_000, JPY=×10^6 (100 JPY → 100 minor units, never
10_000), KWD=3-decimal distinct from USD cents, unknown currency throws, non-whole micros throw.
bridge tests prove a 240 JPY Meta budget maps to 240 minor units (no 100× inflation) and an alias
without currency is rejected. Meta provider tests updated for the currency-aware deltas.

## Known limitations / deferred
- The engine's Python compute layer (ROAS/CPA over fixtures) is USD-only synthetic data; per-currency
  correctness there and real FX normalization are Phase 1+ (the engine is vendored byte-identical).
- A real multi-currency rollup with FX requires an FX source; Phase 0 explicitly refuses to invent one.
