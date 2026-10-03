# Phase 0 — Implementation Log

Running log of the Phase 0 completion program. Newest entries at the bottom of each section.
Baseline: `docs/phase0/00-baseline.md`. All work on `claude/amazing-heisenberg-0unnak`.

## P0-A — write-path safety (DONE before this program)
Commits `5293e5d`, `2324133`. Actor model, atomic/idempotent apply, apply-time revalidation,
immutable-preview digest, generic-tool gate, Meta typed-write ownership, forward-only migration
`20261003000000_phase0_write_safety.sql`. See `docs/phase0/P0-A-EXIT.md`.

## This program (master Phase 0 completion)
Started from HEAD `2324133`. Order: A (close) → B (money) → C (tenant/engine) → D (data ownership)
→ E (CI/guardrails/data-trust/live-states) → F (AI gateway/metering) → adversarial → exit docs.

Scope reality checks against code (global rules 1–2): this repo is adport (platform/) + paid-media-agent
(engine/). It has **no** social-publishing pipeline, n8n/RSS ingestion, calendar, media-attach, or
mobile app. Template sections referencing those (PHASE F publishing, calendar approvals, mobile UX,
RSS webhooks, OUTBOUND_ALLOWED_HOSTS) are recorded NOT-APPLICABLE with evidence rather than invented.

### Entries
- B: implementing canonical Money + currency-exponent table in core (`packages/core/src/money.ts`).
- B DONE: canonical `Money` + `CURRENCY_EXPONENTS` in core (fail-closed on unknown currency); Meta
  provider + bridge `translate.ts` now convert minor↔micros with the currency exponent (fixes the
  JPY/KRW 100× and KWD 10× defects); dashboard `live-data.tsx` groups money by currency and never
  blends spend/ROAS across currencies (no invented FX). BudgetDelta now carries currency on Meta/sandbox.
- E (partial): live-mode safety-state enum `runtime-mode.ts` (no FULL_AUTONOMOUS_WRITE; default
  LIVE_WRITE_DISABLED non-demo; apply gated), wired `assertApplyAllowed()` into the dashboard apply
  route. Data-trust floor `data-trust.ts` (tiers + INSUFFICIENT_EVIDENCE; synthetic isolated).
- Four read-only audits captured (provider ownership, money, tenant isolation, infra facts) — drive
  the remaining A-close, C (engine reports IDOR SEC-01 confirmed), self-approval default, CI, docs.
- C DONE: engine report IDOR (SEC-01) fixed — per-org X-Markting-Org scoping on run/list/file, fail
  closed; cross-tenant regression test. Tenant-isolation audit: all cloud queries org-scoped, no cache
  leak. R0-08 decision: shared engine + strict tenant-scoped persistence (per-org engine identity
  staged for Phase 1). Docs P0-C.
- A-close DONE: tiktok_set_campaign_status foreign-id rejection; X verified account-scoped; Apple
  generic gated. Docs P0-A-EXIT.
- D DONE (doc + path): data-ownership map (adport=business truth, engine pma_*=execution); forward-only
  `make migrate`; db reset marked LOCAL ONLY; CI applies migrations. Docs P0-D.
- E DONE: root CI (.github/workflows/ci.yml) incl DB-gated lane + drift + scanners; self-approval
  default false; kill-switch pinned (F1 fixed, engine suite 177 green clean); data-trust + live-state
  modules; Next.js reachability recorded (blocker, same-origin only); outbound N/A documented. Docs P0-E.
- F DONE (doc + path): no browser->model path (holds); gateway deferred to Phase 1 with rationale;
  metering is request-count-only today (honest), ledger designed. Docs P0-F.
- Docs: P0-A..F exit, PRODUCTION-VERIFICATION-RUNBOOK, RELEASE-NOTES written. Adversarial red-team pass
  running; PHASE0-EXIT-REPORT + gates to follow its findings.
