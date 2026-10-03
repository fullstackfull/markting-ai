# 10 — Security Validation (Stage 16)

| Check | Status |
|---|---|
| Dependency scan (pnpm audit high+) | GREEN (CI security lane) |
| Python dependency audit (pip-audit) | GREEN (CI) |
| Secrets scan (gitleaks) | GREEN (CI) |
| RLS / tenant isolation | RUNTIME_PROVEN (CI real Postgres, Phases 3–7 + launch drills) |
| Webhook signature + replay + dedup | PROVEN (Phase-5 commerce webhooks, server-resolved org) |
| Service-account scope / expiry / revocation | PROVEN (Phase-7; fail closed) |
| MCP token lifecycle | PARTIAL — scope + rotation + revoke modeled; full refresh-cascade is design |
| Rate limits | model + existing `rate_limit_buckets`; backend enforcement at edge |
| Segregation of duties (self/model/service-account/4-eyes) | PROVEN (Phase-7 + write-time guard) |
| Kill switch fail-closed | PROVEN (Phase-7 + launch drill) |
| OAuth callback validation / CSRF / SSRF / session controls | PARTIAL — app-middleware concerns; validated where code-testable; edge/session hardening is deploy-time |

No high-severity issue is open in the scanned surface. The app-perimeter items (CSRF/SSRF/session/
callback allowlisting) are documented deploy-time requirements; the governance/data layer is proven.
