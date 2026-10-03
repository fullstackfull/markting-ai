# 05 — Kill Switch & Emergency Lock (7F)

`ops/kill-switch.ts`, `ops/store.ts`.

Five scopes: GLOBAL / ORGANIZATION / PROVIDER / ACCOUNT / ACTION_TYPE. An active switch stops NEW
provider writes immediately; read/analysis continues unless a switch explicitly sets `blocksReads`.
State lives in cluster-safe AUTHORITATIVE storage — the `markting_kill_switches` DB table, NOT the
local filesystem — so every node sees the same state and it does not depend on model availability.

`assertWriteNotKilled` is called before every provider write and FAILS CLOSED: if the switch table
cannot be read, the write is blocked. Platform-wide scopes (GLOBAL/PROVIDER/ACTION_TYPE) use a NULL
organization_id; `listActiveKillSwitches` returns platform switches (org NULL) plus the caller's own
org switches only — never another org's. Every kill-switch change is captured as a change record.

Emergency lock: an enterprise admin with `emergency_lock` can set a GLOBAL switch (all writes), a
PROVIDER switch (one provider), an ACCOUNT switch, or an ACTION_TYPE switch — all independent of model
availability.
