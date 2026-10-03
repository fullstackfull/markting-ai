# 00 — Production Environment Contract

This records the REQUIRED production environment and its CURRENT status in this validation environment.
No secrets appear here. "BLOCKED_EXTERNAL" means the capability is not provisioned in this container and
must be supplied by the operator at deploy time; it was NOT faked.

| Component | Required | Current status |
|---|---|---|
| Production hostname(s) | managed HTTPS host | BLOCKED_EXTERNAL (no managed hosting here) |
| App runtime | Next.js 16 (node) | code-proven; runs in CI |
| Database runtime | managed Postgres / Supabase | real Postgres exercised in CI `cloud-db` lane |
| Worker runtime | durable worker pool | BLOCKED_EXTERNAL (no worker host) |
| Queue backend | durable (pg-boss/Redis/SQS) | BLOCKED_EXTERNAL; lease model proven on Postgres |
| Object storage | S3-compatible | BLOCKED_EXTERNAL |
| KMS | cloud KMS master keys | BLOCKED_EXTERNAL; rotation-safe envelope proven in a drill |
| TLS termination | edge TLS | BLOCKED_EXTERNAL (no edge here) |
| Logging | structured log sink | BLOCKED_EXTERNAL; redaction model proven |
| Metrics | metrics backend | BLOCKED_EXTERNAL; metric model defined |
| Tracing | trace backend | BLOCKED_EXTERNAL; trace stages defined |
| Email | transactional email | BLOCKED_EXTERNAL |
| OAuth callback URLs | HTTPS callbacks per provider | BLOCKED_EXTERNAL (require live provider apps) |
| Model gateway | governed AiGateway → approved model | BLOCKED_EXTERNAL (no live model creds); local fallback proven |
| Commerce callbacks/webhooks | HTTPS signed webhooks | BLOCKED_EXTERNAL; signature/replay/dedup proven on fixtures |

The operator fills every BLOCKED_EXTERNAL row at deploy via environment configuration; the code paths
that consume them are built and tested (fixtures/sandbox/local-fallback).
