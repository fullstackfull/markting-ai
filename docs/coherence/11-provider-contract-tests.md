# 11 — Provider Contract / Replay Tests — NOT_STARTED

The reassessment (`docs/reassessment/07-test-quality.md`, P0 #1) found providers are verified only
against hand-written `fakeFetch` fixtures, with no recorded-cassette / schema-validation contract tests
(no nock/msw/polly/vcr in the repo). A provider API change passes CI while production breaks.

## Status — NOT_STARTED this pass

No provider contract/replay harness was added. This is a genuine remaining P0 for live readiness. The
recommended increment (unchanged from the reassessment):

1. Introduce a recorded-cassette library (e.g. msw/nock) for the TS provider packages.
2. Capture sanitized real-shape responses for Meta and Google first (the ACTION_READY providers), then
   TikTok/Snapchat, and validate the normalization layer against them.
3. Add schema validation against the published provider API schemas where available.

**Why not done now:** capturing realistic provider payloads needs either live credentials
(`BLOCKED_EXTERNAL`) or a curated corpus of sanitized real responses that does not exist in-repo;
fabricating "realistic" payloads would reproduce the exact weakness the reassessment flagged. This is
recorded honestly as outstanding rather than papered over with more self-authored fixtures.
