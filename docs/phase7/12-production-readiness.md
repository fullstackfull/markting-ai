# 12 — Production Readiness

A first paying customer requires more than green tests. Honest status of the outstanding blockers:

| Area | Status | Note |
|---|---|---|
| Live provider OAuth / write | BLOCKED_EXTERNAL | no credentials; controlled-write pilot is a runbook (doc 11). |
| Live model | BLOCKED_EXTERNAL | governed AiGateway + local fallback only. |
| Real commerce | BLOCKED_EXTERNAL | Phase-5 connectors FIXTURE_PROVEN. |
| KMS | PARTIAL | rotation-safe software envelope implemented; cloud-KMS-backed master keys BLOCKED_EXTERNAL. |
| TLS / network topology | DESIGN | documented (doc 09); enforced at the hosting edge, not in this env. |
| Backup restore | BLOCKED_EXTERNAL | design + procedure (doc 08); no restore drill run → not "ready". |
| Hosting | BLOCKED_EXTERNAL | managed cloud not provisioned here. |
| Observability backend | PARTIAL | in-process model + redaction + SLOs + alert dedup; metrics backend wired at the edge in prod. |
| Next.js / security dependencies | GREEN | CI security lane (pnpm audit high+, pip-audit, gitleaks) green. |
| Live write pilot | HELD | runbook ready; execution requires credentials + explicit authorization. |

## First-customer onboarding (each step marked honestly)
Create org ✓ · Invite users ✓ · Connect provider BLOCKED_EXTERNAL · Connect commerce BLOCKED_EXTERNAL ·
Configure business targets ✓ · Run sync (fixtures) FIXTURE_PROVEN · Ask AI (local fallback)
SANDBOX/FIXTURE · Review recommendations ✓ · Create preview ✓ · Approve ✓ (governed) · Execute
controlled action HELD (needs live creds) · Audit it ✓ (DB-proven) · Measure outcome ✓ (engine).

The GOVERNANCE path is production-grade and DB-proven; the LIVE legs are externally blocked and never
faked.
