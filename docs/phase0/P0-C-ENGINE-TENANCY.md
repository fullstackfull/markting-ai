# P0-C Exit — Tenant/engine isolation (R0-07) and the engine tenancy decision (R0-08)

Status: R0-07 reports/prose isolation **COMPLETE**; R0-08 decision **MADE** (implementation of the
per-tenant engine identity is staged for Phase 1 behind the kept fail-closed default).

## R0-07 — what was fixed
The engine report surface was a global index + flat file dir keyed only by the shared bridge token:
any authenticated user could list and download any org's report runs (confirmed IDOR / SEC-01). Fix:
the trusted cloud forwards the tenant org via `X-Markting-Org`; the engine host
(`services/engine-demo/serve_demo.py`) tags each run with its org, filters `/reports` to the caller's
org, and verifies a requested artifact belongs to the caller's org before serving it (404 otherwise,
no existence disclosure). Missing org header → 400 (fail closed). Cloud `EngineClient` sends the
header on run/list/file; the three report routes pass `principal.organizationId`. Regression tests:
engine-client sends the header; engine-demo proves org B cannot list or download org A's run.

## Tenant-isolation audit result (cloud)
Every DB-backed cloud query is organization-scoped (pending_operations, audit_events, markting_threads,
markting_engine_proposals, markting_sandbox_state, markting_account_aliases, api_keys create/list,
provider_credentials, connections, ad accounts, findings, subscriptions, settings). api-key and
mcp-oauth lookups are capability/secret-scoped by design. No un-scoped cloud query. Thread ids are
namespaced `org_<org>__u_<user>__…` and gated in the cloud (regex + claimThread). No tenant-data cache
is missing an org key (the only cache is React request-scoped `requireDashboardTenant`). No route
trusts an org id from the request body without `resolveMembership`, and none derives org from AI text.

## Conversation prose / checkpoints
The engine conversation checkpoint and thread-ownership store are keyed by the org-prefixed thread id;
isolation holds via the cloud prefix gate. The report index is now per-org. Residual: the engine is a
single process with one caller_ref, so engine-side isolation is a single layer (the cloud). This is
acceptable while the data is synthetic fixtures and writes are off; the defense-in-depth per-tenant
engine identity is the R0-08 implementation, staged for Phase 1.

## R0-08 — engine tenancy decision
Chosen: **(A) one shared engine process with strict tenant-scoped persistence**, not a process per
tenant. Rationale: the engine holds no durable authoritative business state (that lives in adport
Postgres, see P0-D); its per-request work is analysis over tenant-scoped reads plus proposal/receipt
rows. A shared process with (1) a per-org identity carried from the cloud (today `X-Markting-Org`;
Phase 1: a per-org caller_ref or signed org claim so the engine's own `threads.owner`/checkpoint
namespace enforces isolation as defense-in-depth), (2) per-org report index/files (done), and (3)
externalized shared state (report index, kill switch) is sufficient and far cheaper than per-tenant
isolation. Per-thread serialization and an externalized durable kill switch are Phase 1 hardening.
The fixture-only fail-closed default (R0-12) stays in force until that lands and a second replica or
live mode is explicitly approved.

## Not done in Phase 0 (deferred, by the decision)
Per-org caller_ref to the engine; per-thread run serialization (today a single global asyncio lock
serializes report runs); cluster-safe externalized kill switch and report index store.
