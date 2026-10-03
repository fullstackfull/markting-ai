# 07 — Test Quality & Coverage Assessment

**Lens:** test/QA architect. **Scope:** all vitest suites in `platform/apps/cloud/test/`, the
provider/core/mcp package suites, the engine Python suites, and `.github/workflows/ci.yml`. @ `affdecc`.
Read-only; every claim backed by a file opened. Tags: `VERIFIED_TEST` etc.

## Headline

The suite is large and green but **systematically tests code against itself.** The "AI evaluations,"
the provider "E2E"s, and the engine "behavior" tests all assert that deterministic, hand-written code
behaves as coded — against fixtures the same authors wrote. There is **no live model benchmark in CI,
no recorded/replayed real provider traffic, no browser/E2E, and no interactive UI testing anywhere.** A
high passing count is close to meaningless as a coverage signal for the things a media-buyer SaaS most
needs to trust.

## 1. Are the `*-eval` suites genuine evaluations? — NO (deterministic unit tests)

The cloud `*-eval` suites are deterministic assertions over coded analysis functions, not model/
behaviour evals. The files self-describe: *"The LLM narrates these governed signals; it does not compute
them, so correctness is asserted here on the layer that produces the numbers."* Representative:
`expect([...cpa.factors].sort(...)[0]?.factor).toBe('click_through')`;
`expect(roas.from).toBeCloseTo(4)`; phase7's "40 governance scenarios" are all state-machine checks.
These are *good deterministic tests of the analysis engine* — but calling them "AI Evaluation 7.0 — 40
scenarios" overstates them: no LLM output is ever graded. `VERIFIED_TEST`.

The **only** genuine model eval is `engine/tests/eval/{questions.json,run_questions.py,grade.py}` —
`run_questions.py` sends each question to a live langgraph agent server and records actual tool calls +
answer; `grade.py` checks the answer quotes the correct figures. But it is a `__main__` script, not a
`test_*.py`, so **pytest never collects it → it does not run in CI** (`ci.yml` runs `pytest -q`), and
grading is number-substring presence, not a reasoning rubric. The engine `behavior/` tests run the real
graph with a **scripted/fake model**, deterministic not live.

## 2. Coverage gaps

- **Browser / E2E: entirely absent.** No Playwright/Cypress/Puppeteer anywhere (grep across all
  `package.json` for `playwright|cypress|puppeteer|@testing-library|jsdom|happy-dom` → no matches).
  `engine/tests/e2e/` is a single Node script, not in CI. `VERIFIED_TEST`.
- **UI component tests: shallow.** `.test.tsx` files use `renderToStaticMarkup` and assert on HTML
  substrings; no jsdom, no testing-library, no user events — clicks/state/hooks/OAuth-popup never
  exercised. `VERIFIED_TEST`.
- **Provider CONTRACT tests: fixtures only, not real contracts/replay.** `meta/test/meta.test.ts` and
  `mcp/test/meta-e2e.test.ts` use a hand-rolled `fakeFetch`/`vi.stubGlobal('fetch')` returning
  responses the authors typed; no nock/msw/polly/vcr, no schema validation against a published provider
  OpenAPI. If Meta/Google change a field, these stay green while production breaks. **Biggest contract
  risk.** `VERIFIED_TEST`.
- **Live-replay tests: absent.** The only live-touching tests are engine opt-in checks (skipped unless
  `PAID_MEDIA_LIVE_TESTS=1`); no TS provider has any live or recorded-traffic test.
- **Over-mocking.** `ai-gateway.test.ts` injects the model call as a fake callback — tests cost/quota,
  never a model.

## 3. Are the DB-gated tests meaningful? — MOSTLY YES (a genuine strength)

`database.integration.test.ts` runs against a **real Supabase/Postgres** (gated by
`ADPORT_RUN_DATABASE_TESTS=1`; CI spins up `supabase start` + `migration up`) and does real work:
real RLS with per-user JWTs (org A sees only its own row, empty for org B); encryption-at-rest
(ciphertext ≠ plaintext token); cross-tenant store isolation; and a real optimistic-lock race
(`Barrier(2)` + `ThreadPoolExecutor`, exactly one writer wins). `VERIFIED_TEST`. **Caveat:** isolation
is proven for a handful of tables (organizations, feedback, findings, credentials), not systematically
across all tables, and not for the service-role bypass path.

## 4. Is AI evaluation real? — NO live benchmark, NO golden answers

No test in CI invokes a real Anthropic/OpenAI model. The "media-buyer evaluation" grades coded verdicts,
not model narration. No regression guard on prompt/model changes degrading answer quality.

## 5. Test types ABSENT that a production media-buyer SaaS needs

Browser/E2E across auth→connect→select→recommend; interactive UI (testing-library + jsdom); real
provider contract tests (recorded cassettes / schema validation); live-model regression eval in CI with
a scored rubric; load/rate-limit tests against real provider pagination; visual-regression / a11y;
migration forward+rollback (CI runs `migration up` only); real Stripe test-mode billing; chaos/
failure-injection for apply/rollback beyond scripted transitions.

## Top 10 test-quality gaps

1. **[P0]** No real provider contract/replay tests — providers verified only against self-authored
   fixtures; a provider API change passes CI but breaks production (all 11 provider packages).
2. **[P0]** The genuine agent eval is not in CI (`run_questions.py` is a `__main__` script, not
   collected).
3. **[P0]** No browser/E2E coverage of the core user journey.
4. **[P1]** "AI Evaluation" suites are deterministic unit tests mislabeled as evals.
5. **[P1]** UI tests are static-render string matching, no interaction.
6. **[P1]** The LLM layer is faked in the one test that touches it.
7. **[P1]** RLS proven for only a few tables; no systematic policy-regression coverage.
8. **[P2]** Engine "behavior" tests use a scripted model (agent reasoning under a real model unverified
   in CI).
9. **[P2]** No migration rollback / destructive-change testing.
10. **[P2]** "Performance" testing is an in-process micro-benchmark, not real load/rate-limit. (P3: no
    visual-regression / a11y.)

## Net

Strengths are real and worth crediting: the deterministic analysis engine is thoroughly pinned (good
numeric/uncertainty/tenant-attribution assertions), the DB-gated RLS/isolation/concurrency tests run
against real Postgres with real JWTs and a real optimistic-lock race, and write-path governance is
heavily state-machine-tested. But the three things a media-buyer SaaS most needs to trust — **real
provider API contracts, real model answer quality, and the real user journey in a browser** — are all
either mocked against self-written fixtures or entirely absent. The large passing count is dominated by
deterministic self-consistency checks.
