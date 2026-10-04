# 02 — Canonical Money Formatting (A2)

**Problem:** raw minor units (e.g. "CPA: 3684", "spend ≈ 1680000") reached user-facing surfaces; a canonical
`formatMoney` existed but was unused; the UI `formatMoney` forced 2 fraction digits (wrong for JPY/KWD).

**Fix:**
- `components/ui.tsx#formatMoneyMinor(minor, currency, locale)` — the canonical UI formatter for minor units:
  Intl currency formatting with each currency's own exponent (USD 2, JPY 0, KWD 3); no currency → labeled
  "(currency unknown)" (never guessed); unknown-exponent currency → code shown without rescaling;
  `MIXED_CURRENCY` sentinel passes through. `formatMoney` (whole units) no longer forces 2 decimals.
- Exponents come from `lib/money-ui.ts` (a client-safe copy of `@adport/core` CURRENCY_EXPONENTS, kept
  core-free so the browser bundle never pulls `node:fs`; `test/currency-sync.test.ts` prevents drift).
- Surfaces fixed (no raw minor units): `components/intel.tsx` (forecast/response/scenario/campaign),
  `lib/markting/orchestrator/sections.ts` (section summaries + answer-text via a server-side `minorText`;
  currency threaded into forecast/response/creative-detail sections), creative-detail page, `live-data.tsx`
  and reports tables (whole-unit floats via currency-aware `formatMoney`).
- Tests: `test/money-format.test.ts` (USD / JPY zero-decimal / KWD 3-decimal / unknown / mixed / nullish).
