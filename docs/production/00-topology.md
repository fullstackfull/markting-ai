# 00 — Production Topology (Mode A — Intelligence Only)

This is the REQUIRED production architecture for a Mode-A (read + AI, NO provider writes) deployment.
It is a design + operator contract: this validation container cannot provision cloud infrastructure
(no cloud account access, no deploy target), so every component below is the operator's to provision.
Nothing here is marked as live-provisioned.

```
            ┌─────────────────────────── TLS edge (HTTPS only, HSTS, HTTP→HTTPS) ───────────────────────────┐
  Internet ─┤  app.<domain>  (Next.js cloud app)                                                            │
            └───────────────┬───────────────────────────────────────────────────────────────┬─────────────┘
                            │ (private network)                                              │
                   ┌────────▼─────────┐     ┌──────────────┐     ┌───────────────┐    ┌───────▼────────┐
                   │ App runtime (N)  │────▶│ Durable queue │────▶│ Worker pool    │    │ Governed AI    │
                   │ (stateless)      │     │ (pg-boss/SQS) │     │ (sync/AI/recon)│    │ gateway (server│
                   └───────┬──────────┘     └──────────────┘     └──────┬────────┘    │ side only)     │
                           │                                            │             └───────┬────────┘
                   ┌───────▼───────────────────────────────────────────▼─────────┐           │
                   │ Managed Postgres / Supabase (RLS, private network, pooled)   │           │ egress allowlist
                   └───────┬─────────────────────────────────────────────────────┘           ▼
                           │                                           Approved model provider (allowlisted)
                   ┌───────▼────────┐   ┌──────────────┐   ┌───────────────────────────────────────────────┐
                   │ Cloud KMS      │   │ Object store │   │ Provider APIs (Meta/Google/…) — READ ONLY in A │
                   │ (master keys)  │   │ (reports)    │   │ OAuth callbacks at https://app.<domain>/...    │
                   └────────────────┘   └──────────────┘   └───────────────────────────────────────────────┘
                   Observability: logs + metrics + traces → backend; dashboards + alerts.
```

- **Engine is NOT public.** Only the Next.js app is internet-facing behind TLS; DB, queue, workers,
  KMS, and the engine host sit on a private network.
- **Model is server-side only** — never browser→model; all model calls go through the governed gateway
  with org attribution, token/cost capture, timeout, retry, fallback, redaction, and a model allowlist.
- **Provider writes are structurally OFF** in Mode A (`MARKTING_RUNTIME_MODE=LIVE_RECOMMENDATIONS`);
  `assertProviderWriteAllowed` throws for every mutation attempt (see `ops/mode-a.ts`).

Component status in THIS environment: all BLOCKED_EXTERNAL (operator-provisioned at deploy); the app,
DB schema, governance, and intelligence code paths are proven in CI against real Postgres.
