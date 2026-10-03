# 07 — Provider Contract / Replay Tests — PARTIAL / NOT_STARTED

The deepest provider (Meta) already has documented-shape fixtures (v25.0 insights envelope, string-typed
numbers, actions arrays, paging) in `packages/meta/test/meta.test.ts` exercising the normalization. The
reassessment's P0 was the absence of a recorded-cassette / edge-case replay harness (nullable/missing
fields, multi-page pagination, currency variants, provider errors, schema drift) and the same for Google.

**Status this pass: NOT_STARTED (no new replay harness added).** Honest reason: building realistic
replay cassettes needs either live credentials (BLOCKED_EXTERNAL) or a curated sanitized corpus that is
not in-repo; adding more self-authored fixtures would reproduce the exact weakness flagged. This remains
a standing P0 and the single most important test-integrity gap, recorded rather than papered over.
