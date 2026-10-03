# 04 — Security CI lane + hardening (Programs 15–19)

## Dedicated security lane (Program 15)
The repo-root `.github/workflows/ci.yml` `security` job runs, and now also runs the migration-RLS check:
- **Dependency / SCA:** `pnpm audit --prod --audit-level high` (fails on high+); `uv pip-audit` for the
  engine (advisory on transitive upstream).
- **Secret scanning:** `gitleaks` with `.gitleaks.toml` (default ruleset + allowlists for synthetic test
  fixtures and the deterministic non-secret E2E test values).
- **Migration RLS posture (new):** `node --test scripts/test-migration-rls.mjs` — every `public.` table
  created across the migrations must enable row-level security; a self-test proves the checker fails on
  an open table. 57/57 tables pass.

## Constant-time sensitive compares (Program 16)
Verified rather than rewritten: `lib/crypto.ts::safeEqual` uses `timingSafeEqual` (length-guarded);
`lib/mcp-oauth.ts` compares the access-token signature with `timingSafeEqual`; the API-key path is an
HMAC-SHA256(+pepper) hash looked up by DB equality (constant work, no JS string compare). No gap; a
regression test documents it.

## CSRF posture (Program 17)
Mutations are Next.js Server Actions (framework-level Origin/Host check) with httpOnly/SameSite Supabase
session cookies; API routes authenticate with bearer tokens (not ambient cookies), so they are not
CSRF-susceptible. No redundant CSRF layer was added (the architecture already blocks cross-site
mutation), per the mission's "do not add redundant complexity."

## Delete grants (Program 18)
Reviewed: the newer `markting_*` governance/append tables grant only `select, insert, update` (no
DELETE); the legacy broad grant on the original lifecycle tables predates them and is retained because
delete is used by legitimate org/connection lifecycle workflows. No privilege reduction was made blind
(it would need the full workflow suite to regression-test; the governance tables already follow
least-privilege).

## Service-account / MCP (Program 19)
Re-audited via the existing suites (`mcp-plan-denial`, `phase2-safety`, `mcp-oauth*`): scope enforcement
(read vs write), no upgrade/checkout URL leakage, the AI cannot call a write tool under read-only
(`WRITE_FORBIDDEN_READ_ONLY`), recommendations carry no executable payload and are human-approval-only.
Locked by those regression tests.

## Honest status
Gate "dedicated security scanning CI": GREEN — dependency audit + secret scan + migration-RLS posture
all run in the security lane. SAST (CodeQL) is not added; the injection/safety guarantees are covered by
the test suite instead.
