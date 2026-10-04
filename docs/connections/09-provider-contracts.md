# 09 — Provider Contract Tests & Fixture Provenance

Manifest in code: `test/fixtures/connection-contract-provenance.ts`. Provenance is classified honestly and
asserted in `test/connections-domain.test.ts` (every adapter has a record; **no fixture is labelled
LIVE_CAPTURED because none exists in-repo**).

## Provenance classification
- `LIVE_CAPTURED` — recorded from a real authenticated provider response. **None today.**
- `DOCUMENTATION_DERIVED` — built from the provider's published API docs (official envelope shapes). All 11
  ad providers.
- `SYNTHETIC` — hand-authored shapes/ids, no live capture. All 5 commerce connectors.

## Where the contracts live
- Ad OAuth + runtime: `provider-oauth.test.ts`, `provider-expansion-oauth.test.ts`,
  `provider-expansion-runtime.test.ts`, `google-oauth.test.ts`, `x-oauth-routes.test.ts`,
  `oauth-popup*.test.ts`, `markting-snapchat-wire.test.ts` (header: "official envelope shapes, synthetic ids;
  nothing contacts Snapchat").
- Commerce: `phase5-commerce*.test.ts`, `phase5-redteam-fixes.test.ts`.
- Credential rotation: `credential-rotation.test.ts`. Error safety: `provider-errors.test.ts`.

## Why we did not fake live captures
The mandate forbids claiming live validation without live evidence. There are no tenant credentials in this
environment, so no provider response can be captured. The manifest records this truth so any reviewer can see
exactly what is documentation-derived vs synthetic, and what remains BLOCKED_EXTERNAL for live contract capture.
