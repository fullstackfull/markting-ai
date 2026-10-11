# Phase C.6 — Blocker register (item 44)

Every remaining item that stands between the current state (pre-live operationally ready, credential-free
hardening complete) and live production operation, categorized by what actually unblocks it. Categories:
`CODE_SOLVABLE` · `CREDENTIAL_REQUIRED` · `INFRA_REQUIRED` · `HUMAN_APPROVAL_REQUIRED` ·
`PROVIDER_LIMITATION` · `LEGAL/COMPLIANCE`.

| # | Blocker | Category | Owner | Notes |
|---|---------|----------|-------|-------|
| 1 | Real Meta/Google read verification (Stage 1) | CREDENTIAL_REQUIRED | Customer/ops | Needs real provider tokens in runtime secret storage. The executor shell + normalization prep are ready; only the credentialed read is blocked. Returns `BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED` until supplied. |
| 2 | Remaining 9 ad providers live read | CREDENTIAL_REQUIRED | Customer/ops | Same as #1 per provider (TikTok, Snapchat, LinkedIn, Pinterest, X, Microsoft, Reddit, Spotify, Apple). |
| 3 | Commerce live read (Shopify/Woo/Salla/Zid) | CREDENTIAL_REQUIRED | Customer/ops | Transport + replay contracts proven on fixtures; live needs store credentials. |
| 4 | OAuth code→token exchange + DB transaction consume | CREDENTIAL_REQUIRED + INFRA_REQUIRED | Ops | Hardening invariants modeled/tested; the live exchange needs app credentials + Postgres + a session. |
| 5 | Webhook signature verification against real provider secrets | CREDENTIAL_REQUIRED | Ops | KMS-sealed secret path implemented; real sealed blobs are a deployment input. |
| 6 | Real KMS wiring (ProductionKmsKeyManager) | INFRA_REQUIRED | Ops | Local AES keyring proven; cloud KMS client is a deployment step. |
| 7 | Observability backend (OTLP collector) + metrics store | INFRA_REQUIRED | Ops | Exporters + buffers done; `OpenTelemetryExporter` is a BLOCKED_EXTERNAL stub pending a collector endpoint. |
| 8 | Alert/on-call delivery (email/Slack/pager) transports | INFRA_REQUIRED | Ops | Adapters + escalation + on-call resolver done over injected transports; real transports wired at the edge. |
| 9 | Backup/restore execution + a real DR drill | INFRA_REQUIRED | Ops | DR contract + fail-closed manifest validation + recovery planner done; `executeBackupSnapshot`/`executeRestore` are stubs needing infra. |
| 10 | Production soak/load against real infra | INFRA_REQUIRED | Ops | In-process load/soak/chaos proven deterministically; a real-infra soak is a deployment step. |
| 11 | Enable Mode B (live write with approval) | HUMAN_APPROVAL_REQUIRED | Platform owner | Deliberately HELD. Ladder + approval policy + kill-switch ready; enabling is an explicit human decision, out of scope here. |
| 12 | Enable autonomous optimization | HUMAN_APPROVAL_REQUIRED | Platform owner | Deliberately DISABLED and hard-pinned OFF. Not enabled by any code path. |
| 13 | Activate a live model | HUMAN_APPROVAL_REQUIRED + CREDENTIAL_REQUIRED | Platform owner | AI adapter/failover/validator ready; the live model is BLOCKED_EXTERNAL and un-activatable from code. |
| 14 | Provider attribution/COGS gaps | PROVIDER_LIMITATION | n/a | Attribution is carried only where documented; COGS is merchant-config only — never inferred. These are provider realities, not code bugs. |
| 15 | DSAR legal workflow sign-off + retention windows | LEGAL/COMPLIANCE | Legal | Technical DSAR planner + retention policy are in place; the legal review of windows + process ownership is a non-code gate. |

## Summary

- **CODE_SOLVABLE remaining: none** for the credential-free scope — this was the whole point of Phase C.6.
- The remaining blockers are **CREDENTIAL_REQUIRED** (real verification), **INFRA_REQUIRED** (deployment
  wiring), **HUMAN_APPROVAL_REQUIRED** (Mode B / autonomous / live model — all deliberately held),
  **PROVIDER_LIMITATION** (data realities, not bugs), and **LEGAL/COMPLIANCE** (DSAR sign-off).
- None of these can be closed by writing more code without credentials, infra, or an explicit human
  decision — which is exactly the exit condition Phase C.6 targeted.
