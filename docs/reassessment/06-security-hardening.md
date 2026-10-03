# 06 — Security & Hardening Re-Audit

**Lens:** independent security reviewer. **Method:** every finding re-derived from source this pass;
prior-phase fix claims NOT assumed. @ `affdecc`. Evidence is `file:line`. The P0 below was additionally
**verified directly by the lead** (both migration files read in full).

## Headline

One real **P0** (RLS/grant gap on two Phase-1 tables). Phases 5/6/7 migrations and the entire
ops/auth/webhook/MCP surface are, by contrast, correctly implemented and fail-closed. **No
authorization-drift route, no client-org trust violation, no SSRF.**

## P0 — two Phase-1 tables have NO RLS, NO revoke, NO deny policy

**`VERIFIED_CODE` — confirmed by direct read of both files.**

- `platform/supabase/migrations/20261004000000_phase1_ai_usage.sql` — the file's **only** privilege
  line is `grant select, insert, update on public.markting_ai_usage to adport_backend;`. No
  `enable row level security`, no restrictive `authenticated using(false)` deny policy, no
  `revoke ... from anon, authenticated`.
- `platform/supabase/migrations/20261004010000_phase1_business_context.sql` — same: grant-only.

Every **other** `markting_*` table (bridge, phase2, phase3, phase4+fixup, phase5, phase6, phase7)
follows the house convention: `enable row level security` + a restrictive `to authenticated
using(false) with check(false)` deny + an `adport_backend` policy + `revoke all from anon,
authenticated`. The phase3 migration comment states the convention is "belt-and-suspenders: browser
roles get no grant AND are blocked by a restrictive policy" — the revoke is **load-bearing** precisely
because Supabase's bootstrap `ALTER DEFAULT PRIVILEGES` grants table privileges to `anon`/
`authenticated`. These two tables skip **both** layers.

**Impact:** under the standard Supabase default-privilege posture, any authenticated user (any tenant)
can `SELECT/INSERT/UPDATE` both tables via PostgREST/supabase-js with no row filtering — cross-tenant
read of per-org AI usage/cost (incl. `user_id`, `thread_id`, `model`, `estimated_cost_micros`) and
read/write of every org's `markting_business_context.configured` JSON; write access also lets a tenant
poison the cost/idempotency ledger (`unique(organization_id, request_id, feature)`).

**Severity note:** the severity hinges on the Supabase default-privilege posture (assumed standard);
the **convention-deviation is a defect regardless**. Mitigating context (does not reduce the fix
priority): `markting_ai_usage` is written only by the test-only AI gateway today, and neither table is
wired to the live app — but a forward-only migration adding the standard RLS block to both tables is
the correct remediation and is the **#1 item** in the gap register.

**This mission does not fix it** (assessment-only; implementation is held). It is recorded as the top
remediation for the next build program.

## Other findings

- **[P2] No dependency-vulnerability / SAST lane in CI.** `platform/.github/workflows/ci.yml` has no
  `pnpm audit`/CodeQL/Trivy/Snyk/Semgrep/Dependabot step. (The existing "security" lane runs the app's
  own policy-audit CLI + secret scanning, not SCA/SAST on dependencies.) `MISSING`.
- **[P3] Service-account key hash comparison not constant-time.** `ops/service-account.ts` compares
  SHA-256 hex with `!==`; compared values are hashes (low exploitability) but `timingSafeEqual` would
  match the rigor used for webhook verification. `VERIFIED_CODE`.
- **[P3] Mutating routes have no explicit CSRF token** — rely on the Supabase SSR session cookie's
  SameSite attribute (not verified pinned this pass). `PARTIAL`.
- **[P3] Prompt-injection defense for model-facing text lives in the external engine, not this repo.**
  Repo-side guards are real and good (PII/order-notes stripped before any model call; OCR/ad-copy
  marked DATA-only), but the actual prompt assembly is delegated to `MARKTING_ENGINE_URL`, out of repo
  — instruction-isolation there is unverifiable from this codebase. `PARTIAL`.
- **[P3] Phase-5 grants `delete` on `markting_orders`/`markting_order_lines`** though the header says
  read/analyze-only — defensible for re-sync cleanup, but broader than siblings; confirm the writer
  needs it. `VERIFIED_CODE` (low).

## Verdicts on special-focus areas (all clean unless noted)

- **Authorization drift:** NONE. Every tenant route resolves a **server-derived** org; the
  client-supplied org is validated against `organization_memberships` and throws if absent. Unauth
  routes are all legitimate (locale cookie, public waitlist, signature-verified Stripe webhook). Role
  gates present (apply requires owner/admin + `tools:write`; last-owner protection; "admins can't touch
  owners"). `VERIFIED_CODE`.
- **New tables w/o RLS or over-broad grant:** Phase5/6/7 all correct; insert-only tables correctly get
  only `select, insert`. Only defects are the two Phase-1 tables above. `VERIFIED_CODE`.
- **Server/client trust boundary:** nothing trusts client payload for identity; webhook resolves tenant
  from the authenticated connectionId with signature verified before use; thread id validated to belong
  to the user; apply records requester as `ai_agent` to keep the human approver distinct. `VERIFIED_CODE`.
- **SSRF:** NONE — every `fetch` targets a fixed provider endpoint or server-configured env URL; return
  paths sanitized. `VERIFIED_CODE`.
- **OAuth state:** hashed, user-bound, single-use, 10-min expiry; PKCE verifier stored encrypted.
- **Webhook signature + replay:** HMAC-SHA256 with `timingSafeEqual`, length-checked, 5-min replay
  window + dedup by persisted event identity.
- **MCP token lifecycle:** authorization codes single-use; refresh-token rotation with reuse detection
  + grace window; revocation + expiry enforced; PKCE challenge stored.
- **Kill switch:** fail-closed by contract AND the caller fails closed on an unreadable store; ACCOUNT
  keys org-qualified to prevent cross-tenant collision. `VERIFIED_CODE` + `VERIFIED_TEST`.
- **Mode-A / provider-write lockdown:** `assertProviderWriteAllowed` throws unless `applyWrites &&
  canApply`, true only for LIVE_WRITE_APPROVAL_ONLY + DEMO-sandbox. Independently re-read by the lead.
  `VERIFIED_CODE`.
- **Read-only registry gate:** `WRITE_FORBIDDEN_READ_ONLY` thrown for any non-readOnly tool when
  `ctx.readOnly` (default-deny on undefined). `VERIFIED_CODE`.
- **Approval / SoD:** rejects duplicate actors, requester-as-approver, non-human approvers, missing
  senior; quorum escalates for risk/exposure/protected accounts; apply-time revalidation fails closed on
  missing required live data. `VERIFIED_CODE`.
- **Source-guard / PII:** fail-closed on UNKNOWN/mixed sources; forbidden-field drop + `containsPii`
  tripwire. `VERIFIED_CODE`.

## Top security gaps (ranked)

1. **[P0]** `markting_ai_usage` + `markting_business_context` — no RLS, no deny policy, no revoke.
2. **[P2]** No SCA/SAST dependency-scan lane in CI.
3. **[P3]** Service-account hash compare not constant-time.
4. **[P3]** No explicit CSRF token (cookie-SameSite reliance, not verified pinned).
5. **[P3]** Prompt assembly / instruction-isolation lives in the external engine (unverifiable here).
6. **[P3]** Phase-5 `delete` grant broader than siblings.

## Bottom line

The governance/auth/tenancy/write-safety surface is genuinely strong and fail-closed — one of the
product's real assets. The single material defect is the two Phase-1 tables missing the standard RLS
block, which must be the first thing fixed in the next build program. Not covered this pass: Supabase
default-privilege posture (assumed standard), the external engine's prompt assembly, cookie SameSite
values, and runtime DB verification (static review only).
