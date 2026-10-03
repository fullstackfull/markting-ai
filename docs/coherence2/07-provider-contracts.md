# 07 — Provider Contract / Replay Tests — PARTIAL (Meta edge cases) / NOT_STARTED (Google, cassettes)

The deepest provider (Meta) now has an edge-case replay suite, `packages/meta/test/meta-contract.test.ts`
(4 cases), on top of the existing documented-shape happy-path fixtures:
- **Pagination:** follows `paging.next` across two pages and concatenates rows.
- **Missing/null optional fields:** no actions/clicks/impressions → every metric finite, no NaN (ctr/roas
  guarded to 0).
- **Schema drift:** unknown/extra v26-style fields ignored without crashing.
- **Provider error envelope:** a 500 with the OAuthException body maps through `formatMetaError` and
  throws `PROVIDER_ERROR`.

**Remaining (NOT_STARTED):** the same edge/replay suite for Google (and TikTok/Snapchat), and a recorded-
cassette library capturing live-shaped traffic + schema validation against published provider schemas.
Fixtures here are SYNTHETIC but shaped to the documented v25.0 API; true live-captured cassettes need
credentials (BLOCKED_EXTERNAL) or a curated corpus not in-repo. This is still a standing P0 beyond Meta.
