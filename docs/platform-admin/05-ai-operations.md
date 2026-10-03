# 05 — AI Operations (Discovery)

## Headline
A governed AI gateway, a token/cost ledger, per-window quota, a 5-scope kill switch, and provider-health tracking all
**exist as backend library code + schema + tests**, but are **dormant**: not instantiated in any production call path,
no live model traffic, and **no admin UI**. The only AI-admin surface is the **read-only, tenant-scoped**
`/dashboard/governance` page. There is **no platform (cross-org) AI-ops surface**.

## Gateway, routing, allowlist — EXISTS (backend-only), NOT wired in prod
- `AiGateway.invoke()` resolves model by role, checks idempotency + quota, runs with timeout + bounded retry, records
  usage (`lib/markting/ai-gateway.ts:56-99`).
- **Model allowlist**: role→model map (role outside map refused `:59-61`) + provider allowlist set (non-allowlisted
  throws `PROVIDER_ERROR` `:62-64`; default `{scripted,anthropic,openai}` `:124`).
- **Routing config**: `roleModels` per `ModelRole` (`FAST_ANALYSIS`/`DEEP_ANALYSIS`/`REPORT_GENERATION` `:19-24`); the
  only concrete config `DEMO_GATEWAY_CONFIG` points all roles at `scripted/scripted-demo` (`:118-128`).
- **Reads/analysis only — never a write path** (`:6-17`).
- **Production wiring MISSING:** `new AiGateway(...)` appears only in tests; the sole consumer `analyzeAndAnswer`
  (`lib/markting/intelligence/service.ts:37`) is called only from tests and always returns deterministic local
  narration tagged `localFallback:true` (`:50-55`). So every call records as free `local_fallback`.

## Token / cost ledger — EXISTS (backend-only)
- `markting_ai_usage` (`20261004000000_phase1_ai_usage.sql:5-25`): org, user, request_id, thread, feature, model,
  provider, input/output/cached tokens, latency_ms, `status` (`ok|error|local_fallback|quota_exceeded` `:18`),
  `estimated_cost_micros` (`:21`); idempotency unique `(org, request_id, feature)` (`:24`); org/time index (`:27-28`).
- `PostgresUsageLedger` upserts (`usage-ledger.ts:55-71`); `usageSince()` rolls up count + cost excluding
  `local_fallback` (`:78-84`). Cost is **estimated, not invoice truth** (`:4`), and the demo config supplies no price
  map so cost is always 0 (`ai-gateway.ts:118-128`). Rows are written only by the (unwired) gateway.
- RLS-hardened against cross-tenant browser reads: `20261012000000_phase1_rls_fixup.sql:1-35`.

## Per-org quota — EXISTS (backend-only), demo-wide not per-org-configurable
Enforced in `invoke` over a rolling window: reads `usageSince(org, since)`, records `quota_exceeded` and throws
`POLICY_VIOLATION` (fails closed) if requests ≥ `maxRequests` or cost ≥ `maxCostMicros` (`ai-gateway.ts:77-83`). The
**window counting is per-org**, but the **limit is a single config constant** (`DEMO_GATEWAY_CONFIG.quota` = 24h/1000
req/50M micros, `:127`). There is no per-org quota table or override.

## Kill switch — EXISTS (backend-only); NO toggle UI; guards provider writes not AI calls
Definition `lib/markting/ops/kill-switch.ts:1-68`: 5 scopes GLOBAL/ORGANIZATION/PROVIDER/ACCOUNT/ACTION_TYPE; DB-backed
`markting_kill_switches` (`20261011000000_phase7_governance.sql:56-70`). Guard `assertWriteNotKilled`
(`lib/markting/ops/store.ts:138-145`, fails closed). Toggled via `setKillSwitch` (`store.ts:131-136`) — **called only
in tests; no route/UI.** The governance page states switches are set "through the governed change-management path, not
here" and renders a placeholder (`app/dashboard/governance/page.tsx:60-64`). **It guards provider writes, NOT the AI
gateway**, and is **not called on the live apply path** (see `07`/`13` GAP-SEC-01). (Separately, the engine has a
filesystem kill switch — a different mechanism — per `engine/docs/operations/live-write-runbook.md`.)

## Model health / latency / failure / fallback
Latency + status captured per call (`usage-ledger.ts:16-17`); fallback flag `GatewayResult.localFallback`
(`ai-gateway.ts:36` → `AnalyzeAndAnswerResult.local` `service.ts:33-34,58`). Provider health (distinct) in
`markting_provider_health` (`...phase7_governance.sql:118-127`, states CONNECTED/DEGRADED/AUTH_EXPIRED/RATE_LIMITED/
ERROR/DISABLED), writer test-only. Observability model names metrics/alerts (`lib/markting/ops/observability.ts:6-9,
44-49`) but is in-process/design-only. **No model-level health/latency/failure-rate rollup table, no UI.**

## Can a PLATFORM admin do X today? (0 reachable)
| Action | Status |
|---|---|
| View total AI cost | **MISSING UI** (data in ledger; only single-org sum exists) |
| Cost by org / user / model | **MISSING** (fields stored, no group-by query/UI) |
| Change quota | **MISSING** (code constant) |
| Disable AI for one org | **MISSING** (kill switch guards provider writes, not AI; no UI) |
| Change model routing | **MISSING UI** (code config only) |
| Disable a model | **MISSING UI** (static allowlist) |
| Inspect failures | **BACKEND-ONLY** (status/latency captured, no UI) |
| Inspect live vs fallback | **BACKEND-ONLY** (`localFallback`, no UI) |

## Phase-0 invariants — CONFIRMED enforced in code
No autonomous-write `RuntimeMode` member (`runtime-mode.ts:5-24`); `assertApplyAllowed` fails closed (`:57-65`);
capability matrix grants `applyWrites` only for `LIVE_WRITE_APPROVAL_ONLY`/`DEMO` (`mode-a.ts:26-34`);
`providerWritesPossible()` false in all Mode-A live modes (`mode-a.ts:52-55`); safe live default `LIVE_WRITE_DISABLED`
(`runtime-mode.ts:14,30,37`). The AI gateway additionally cannot reach writes (reads/analysis only).

## Implications
A platform AI-Ops console (fleet + per-org/user/model cost, quota management with per-org overrides, model routing/
disable toggles, failure & fallback inspection, live/fallback status) is **greenfield on top of dormant backend**. The
quota, allowlist, and kill switch need to be **moved from code constants to DB-backed, per-org-overridable config and
actually wired into a live call path** before an admin can meaningfully control them. See `13` GAP-AI-*, `14`.
