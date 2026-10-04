# Phase C.6 — Credential-free production hardening — baseline

Branch `claude/amazing-heisenberg-0unnak`. Entry: Phase A/B/C0/C/C.5 complete, CI 7/7 green,
PRE-LIVE OPERATIONALLY READY, no open P0/P1/P2. Live verification is BLOCKED_EXTERNAL (no credentials).

## Objective + posture

Close every remaining **code-solvable** production-hardening gap that can be completed **without external
credentials**, so the only meaningful remaining blocker is real credentialed verification. This is NOT a
new product phase.

Hard rules held throughout: **no credentials requested, no live provider calls, no pretended live
verification, no provider writes, Mode B HELD, autonomous optimization DISABLED, no live model
activated.** Every live/infra-dependent seam is built to an interface + a fake/local implementation and
marked `BLOCKED_EXTERNAL` where a real external service is required — never faked as live.

## Method

Reuse existing primitives (sync worker/planner, kill-switch, idempotency, kms keyring, observability
model, alert/incident pipeline, capability registry, schema-drift classifier). Build each new capability
as a PURE, unit-tested model or an injectable port with a fake transport, so the hard logic is verifiable
now and only the thin credentialed I/O shell remains for later. Validate on real Postgres where a store
is involved (cloud-db CI lane). Mode B / autonomous optimization / live model are never enabled.

## Scope (code-solvable, this phase)

Live sync executor shell + canonical result contract + pagination + partial-failure/quarantine; schema
versioning; Meta/Google normalization prep (DOCUMENTATION_DERIVED only); search + social diagnostic prep;
commerce transport abstraction + replay contracts; webhook-secret/KMS seam + key management; token-refresh
orchestration; OAuth callback hardening; connection state machine + recovery; alert delivery adapters +
incident escalation + on-call; observability exporters + trace correlation + health deepening; DSAR/
retention + PII classification + admin secret-safety; feature-flag safety; rate-limit policy + cost
budgets; AI adapter prep + output validator + failover; creative pipeline prep; deployment hardening +
config validation + safe defaults; disaster-recovery + load/soak + chaos tests; CI expansion; a six-lens
pre-live self-audit; and a blocker register. See the per-topic docs and `CREDENTIAL-FREE-HARDENING-EXIT-REPORT.md`.
