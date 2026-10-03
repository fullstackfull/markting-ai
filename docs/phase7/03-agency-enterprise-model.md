# 03 — Agency / Enterprise Model (7H)

`ops/agency.ts`, `ops/surfaces.ts`.

Hierarchy: Agency → Client Organization → Workspace → Ad Accounts / Stores → Users. Agency staff may
have scoped access to multiple clients. Every query/action resolves the client scope from the SERVER
membership graph (`resolveClientScope`), never from a client payload, so there is no cross-client
leakage. A write preview carries a prominent client-identity banner (agency / client-org / workspace /
account / provider) so an approver cannot act on the wrong client.

Bulk: read-only bulk views are allowed (client health, spend, anomalies, recommendations, data health);
one-click bulk WRITES across client accounts are refused (`guardBulkOperation`) — they require separate
future governance.

Agency dashboard: clients needing attention, recommendation/approval queues, spend PER CURRENCY (never
a blended total without governed FX), data/connection health, AI usage, failed syncs, failed operations.
Operational reporting is deliberately NON-vanity (no "AI success score"): approval aging, failed
operations, write volume, provider reliability, AI cost, recommendation→approval conversion, outcome
coverage.
