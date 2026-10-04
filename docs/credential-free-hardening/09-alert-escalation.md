# 09 — Alert delivery adapters + incident escalation + on-call (items 19, 20, 21)

`lib/markting/ops/alert-channels.ts`, `lib/markting/ops/incident-escalation.ts`,
`lib/markting/ops/oncall.ts`, tests (15 total). Builds on the existing `alert-delivery.ts`
(`AlertChannel` port), `alerts.ts`, `incidents.ts`.

## Alert delivery adapters (item 19)

Concrete `AlertChannel` adapters — Email, Slack, Webhook — each over an **injected transport** (fake in
tests). No adapter embeds a real network client; the live transport is BLOCKED_EXTERNAL and supplied only
at the edge. Payloads are redacted before delivery (no secrets, no raw tokens). An adapter never throws
into the alert pipeline — a delivery failure is captured, not propagated.

## Incident escalation policy (item 20)

A severity ladder `SEV1..SEV4` mapped from alert severity (CRITICAL→SEV1, …). Each level carries an
`{ ackSLA, escalationTimer, operatorRole }` so an unacknowledged incident escalates deterministically on a
timer. Pure over an injected clock — the escalation decision is testable without wall-clock waits.

## On-call abstraction (item 21)

`OnCallResolver` port resolves "who is on call for this severity/role now":

- `StaticOnCallResolver` — a fixed roster/schedule (config-driven, used in tests + default build).
- `NoopOnCallResolver` — resolves to nobody (safe default when no roster configured; the incident still
  records, it simply has no paging target).

A real paging provider (PagerDuty/Opsgenie) is a BLOCKED_EXTERNAL edge adapter, not implemented here.
