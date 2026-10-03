# 09 — Live Proof (Workstream 0)

## 0.1 Real provider read — BLOCKED_EXTERNAL

No live provider OAuth credentials (Meta/Google/TikTok/Snapchat) are present in this environment
(verified at baseline — no such env secrets). Per the mandate, no live proof is fabricated. The read
path (authenticated org → connection → account read → `normalizeReportRows` → trust metadata →
deterministic analysis → recommendation → evidence refs) is exercised end-to-end against the typed
`@adport/core` boundary + synthetic fixtures through the SAME code a live read uses. Live transport
remains **UNVERIFIED_LIVE_TRANSPORT**. Priority when credentials exist: Meta → Google → TikTok →
Snapchat, read-only, one test account first.

## 0.2 Live model narration — BLOCKED_EXTERNAL

No marketing-model credentials for the governed gateway's allowlist are present. (The session's own
model access is an agent proxy, not a product gateway key; wiring it into the product would be
fabricating live proof, which the mandate forbids.) The gateway keeps the free deterministic local
narration (recorded `local_fallback`), which carries the SAME structured facts a model would narrate.
When a model is wired, the gateway already enforces tenant attribution, model allowlist, token/cost
capture, latency, retry/idempotency, and quota (Phase 1I/1J), and the final prompt assembly must place
provider content in clearly-delimited untrusted-data structures (never interpolated into instruction
text) — a dedicated prompt-injection review is required at that point (recorded, not yet runnable).

## CI / database proof — RUNTIME_PROVEN

The root CI runs for real on this branch (`workflow_dispatch`). The Phase-3 forward-only migration
`20261006000000` applies in the `cloud-db` lane and the Phase-3 store suite
(`phase3-stores.database.test.ts`: tenant isolation across memory/decision events/outcomes/jobs/
playbook/timeline, lifecycle, dedup'd atomic job claim) passes against real Postgres. Green run:
**run id 37122913556 — all six lanes `success`, including the DB lane.** (The final run id after the
Phase-3 red-team fixes is recorded in the exit report.)

## Core Phase-3 is not blocked

Decision history, outcome measurement, marketing memory, effectiveness, learning signals, timeline,
playbook, and the evaluation suite are all CODE_COMPLETE + unit-proven, and the persistence layer is
RUNTIME_PROVEN via the CI DB lane. The two external gaps above do not block any of it.
