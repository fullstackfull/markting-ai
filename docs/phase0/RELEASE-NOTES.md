# Phase 0 — Operationally important behavior changes

Read before deploying or upgrading. These are behavior changes an operator must know about.

- **New approval semantics (all write surfaces).** Applying a previewed change now requires a human
  approver distinct from the requester, enforced in the policy engine, not just the dashboard. API
  keys and MCP/OAuth clients can create previews but can no longer apply them. Any integration that
  relied on an API key validating-then-applying in two calls will now get `APPROVAL_REQUIRED`.

- **Live writes default off.** A fresh non-demo deployment resolves to `LIVE_WRITE_DISABLED`; the
  dashboard apply route returns 409 until `MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY` is set
  (gated behind the Phase 0 exit). There is no autonomous-write mode.

- **Self-approval default flipped.** Root `.env.example` now ships `MARKTING_ALLOW_SELF_APPROVAL=false`
  (was `true`). Keep it false for any real team. Single-user demos may set it true explicitly.

- **Currency units.** Budget writes now convert using the account currency's decimal exponent. Meta
  budgets for zero-decimal (JPY/KRW) and 3-decimal (KWD/BHD/OMR) accounts are now correct (previously
  100× / 10× wrong). An unknown currency fails closed. A Meta alias binding with no currency can no
  longer produce a budget preview.

- **Dashboard money.** The overview no longer sums spend or blends ROAS across currencies; it groups
  by currency and suppresses a blended ROAS when accounts span currencies (no invented FX).

- **Engine report isolation.** The cloud now sends `X-Markting-Org` to the engine host; the host
  scopes report listing and downloads per organization and fails closed (400) without it. Any
  external caller of the engine report endpoints must send the header.

- **Migrations.** Production schema changes apply forward-only (`make migrate` / `supabase migration
  up` / `db push`). `supabase db reset` is LOCAL ONLY and must never run against a deployed DB.

- **Workspace scoping / kill switch.** Running the engine-host from tests no longer leaves a stray
  `engine/workspace/KILL_SWITCH`; the path is pinned via `PAID_MEDIA_KILL_SWITCH_PATH` in CI/make.

- **Manual Arabic PDF gate.** Arabic report shaping is a manual production gate
  (`PRODUCTION-VERIFICATION-RUNBOOK.md`); report generation stays blocked if shaping is broken.

- **Not applicable to this product (recorded, not shipped):** `OUTBOUND_ALLOWED_HOSTS` / internal
  webhook/RSS/n8n behavior — this product has no such ingestion surface. If one is added later it must
  ship default-deny with SSRF tests. AI builder actions consuming credits — not applicable; there is
  no token metering yet (request-count limit only; demo model is free).
