# 04 — Meta normalization prep (item 7)

`lib/markting/ops/meta-normalization-prep.ts` + `test/normalization-prep.test.ts` (shares the file with
Google).

**DOCUMENTATION_DERIVED only** — grounded in the real Meta adapter shape (`packages/meta/src/provider.ts`
`InsightsRow` + `omni_purchase` action attribution). No live Graph API call is made; the fetch is marked
BLOCKED_EXTERNAL and never invoked.

- `META_INSIGHT_FIELD_MAP`: documented Meta Insights columns (spend/impressions/clicks …) → canonical
  metric keys, so the output feeds the existing `normalizeReportRow` unchanged.
- `normalizeMetaInsightRow(raw)` → `{ok:true,row}` | `{ok:false,reason}`. Emits canonical keys
  (spend/impressions/clicks/conversions/conversion_value). Entity level is resolved from the deepest id
  present (account/campaign/adset/ad).
- **Never infers currency/FX** — currency is left unset rather than guessed. Carries through **only** the
  documented `omni_purchase` action attribution from `actions`/`action_values`; fabricates no attribution.
- `classifyMetaInsightRow(raw, driftBreaking)` → `ACCEPT | REJECT | SCHEMA`, fitting
  `ProviderTransport.classifyRow`.
- `META_INSIGHTS_CONTRACT`: a `ProviderContract` of expected fields for `detectSchemaDrift`.

Tests use FAKE sample payloads only and round-trip through the real `normalizeReportRow`.
