# 12 — Remediation & Evolution Roadmap

## How to read this

This is the audit's dependency-ordered plan for turning MARKTING-AI from a well-guarded, proposal-only demo over synthetic fixtures into a safe, multi-tenant, genuinely intelligent media-buying product. It is organized into **Phases 0–7 strictly by dependency**, not by calendar: Phase 0 is the gate everything else sits on (safety invariants, the architecture decisions that constrain every later phase, the data-trust floor, and the verification machinery to prove any of it); each later phase may only begin once its dependency items are met. Every item carries an ID (`R<phase>-NN`), the problem, why it matters, its dependency item IDs, the files/subsystems it touches, its architecture / security / data-migration impact, test requirements, a T-shirt complexity, and acceptance criteria. There are **no dates and no effort-in-days** by design — this is a sequencing document, and effort estimation is the owner's to add. Every item traces either to one or more finding IDs from the register (`docs/audit/11-agent-findings-register.md` and the K-council memos `docs/audit/agents/K*.md`) or to an **explicit product decision** called out as `[PRODUCT DECISION]`. This roadmap writer (seat K11) verified the load-bearing Phase-0 citations in code at HEAD before writing; all held (see the spot-check line at the end).

### Classification / severity legend

Finding references use the register's severity tags: **P0** (security / data loss / cross-tenant / unsafe ad execution), **P1** (production blocker / serious financial risk), **P2** (substantial functional/reliability deficiency), **P3** (quality/polish), **GAP** (missing capability, not a defect unless the code claims to provide it). Council adjudication: the live-today P0 count is **0–1** (K4 rules P0=0 today because every cross-tenant/execution P0 is latent on the un-exercised live-write path or org-scoped on synthetic data; K1 keeps the zero-decimal currency bug as a latent P0). Complexity is **S / M / L / XL** (relative structural size, not time). Canonical dedup clusters referenced as `#1..#12` are the twelve cross-reported defects in the register's deduplication note.

### The one-sentence premise this plan is built on

Confirmed by the entire council from code at HEAD: the engine host **refuses to start unless it is pinned to fixture data with an empty approver set and the kill switch engaged** (`services/engine-demo/serve_demo.py` `assert_fail_closed` + `demo_settings`), so no tenant account ever reaches the model today; the product's write-safety is genuinely strong on the model→proposal→Assistant path but **broken on adport's own REST/MCP write surfaces** (`app/api/v1/tools/[tool]/route.ts` applies a write after only a scope check — no human approver). Phase 0 both preserves the first property and closes the second before anything live ships.

---

## Phase 0 — Safety invariants, architecture decisions, data trust, verification (the gate)

**Entry condition:** none. **Exit condition:** all R0 acceptance criteria met. **Nothing in Phases 1–7 that touches a live ad account, a live model, or a second tenant may ship before Phase 0 exits.** Phase 0 deliberately contains the architecture *decisions* (R0-08, R0-09, R0-12) that constrain every later phase, even where their *implementation* lands later.

### R0-01 — Make approval-apply atomic and idempotent
- **Problem:** `PolicyEngine.apply` reads the pending row, writes to the real ad platform, then soft-deletes the row with an unconditional update — no compare-and-consume, no idempotency key. Two concurrent or retried applies of one pending id both call `applyWrite` (reproduced 4× at runtime).
- **Why it matters:** a double budget/status/targeting write to a real ad account on a single human approval — direct unsafe ad execution and financial risk.
- **Depends on:** none (foundational).
- **Files/subsystems:** `platform/packages/core/src/policy/engine.ts`, `platform/packages/core/src/policy/pending.ts`, `PostgresPendingStore`, `app/api/approvals/[id]/apply/route.ts`, `app/api/v1/tools/[tool]/route.ts`, `/mcp` apply handler. The correct CAS + `mark_used`-before-mutation pattern already exists upstream in the Python engine (`pma_approvals`) and should be mirrored.
- **Architecture impact:** introduces atomic claim/consume as a cross-surface invariant; a prerequisite for any multi-replica engine (R7-01).
- **Security impact:** closes the BROKEN replay invariant (SEC-02, invariant #12).
- **Data migration:** add an idempotency/claim column (e.g. `claimed_at`/`applied_idempotency_key`) to the pending table; forward-only.
- **Test requirements:** concurrency test (two parallel applies → exactly one `applyWrite`), retry-after-crash test, regression guard in CI. No such test exists today.
- **Complexity:** M
- **Acceptance:** two concurrent applies of one pending id produce exactly one provider write and one `applied` outcome; a retried apply after a provider success is a no-op; test runs in CI.
- **Traces:** cluster #3 (K6-01, F6-01/F7-01/F9, D5, D9, E10/E11 SEC-02, D4, D7).

### R0-02 — Enforce human approval and requester≠approver on ALL write surfaces
- **Problem:** the four-eyes guarantee holds only in the dashboard apply route, and even there it is skipped when `row.createdBy` is null (all API-key/engine-created pendings) and defaults off in a shipped template. adport's REST `app/api/v1/tools/[tool]/route.ts` and `/mcp` apply a previewed write after only a scope check — **no human approver at all**.
- **Why it matters:** the README's "nothing is applied until a human approves" is false on the REST/MCP surfaces; any `tools:write` key holder can validate-then-apply with no second human. This is the product-level write invariant being broken (K2 V2, K3-03).
- **Depends on:** R0-01 (atomic consume is where the approver check must live), R0-03 (shared risk gate).
- **Files/subsystems:** `app/api/v1/tools/[tool]/route.ts`, `/mcp` handlers, `app/api/approvals/[id]/apply/route.ts:22` (null-`createdBy` short-circuit), `PolicyEngine` (`engine.ts:104` — `apiPrincipal` has no `userId`), engine `/proposals/{id}/reject|edit`.
- **Architecture impact:** moves the approver check out of the dashboard layer into the shared policy/apply seam so every surface inherits it.
- **Security impact:** closes SEC-26 (self-approval, P2) and the K2/K3-03/C7-01/C13-01 autonomous-write holes (P1); upgrades four-eyes from PARTIAL to HOLD.
- **Data migration:** require a non-null actor on every pending; backfill or reject legacy null-actor rows.
- **Test requirements:** route/authz tests on apply across dashboard + REST + MCP (currently **zero** route-authz tests exist); self-approval-blocked test for null `createdBy`; requester≠approver enforced on REST/MCP.
- **Complexity:** M
- **Acceptance:** no write surface applies a previewed mutation without a human approver distinct from the requester; `MARKTING_ALLOW_SELF_APPROVAL` is the only (explicitly documented, default-off) exception.
- **Traces:** cluster #2 (C13-03, K4 SEC-26, K2-V2/P2-07, C7-01, E5-02, G6), K3-03.

### R0-03 — Cap or retire the generic `*_api_create/update/remove` tools; mirror the risk classifier on the adport write path
- **Problem:** generic `*_api_update` / `*_api_remove` (Google, Meta, TikTok, Apple, Microsoft, Reddit) accept arbitrary API bodies and make uncapped status/bid/targeting/destructive changes; only `/budget/i` keys are policed. `api_create` of a campaign is coerced PAUSED and budget-checked (the real hole is update/remove, correcting C7-02's framing).
- **Why it matters:** an approved generic update can change targeting, pause/unpause, or delete objects with none of the budget rails — uncapped mutation of a real account.
- **Depends on:** R0-02 (approval must gate these too).
- **Files/subsystems:** `engine/.../tools/catalog.py` (deny-by-default catalog), adport provider generic tool handlers, `platform/packages/core/src/policy/policy.ts`. The engine already has a deny-by-default tool catalog and a risk classifier; mirror that classifier on the adport write path and retire or tightly scope the generic API passthroughs.
- **Architecture impact:** a single risk-classification layer shared by engine and adport write paths.
- **Security impact:** removes the uncapped-mutation blast radius (P1).
- **Data migration:** none.
- **Test requirements:** tests that generic update/remove is either rejected or subject to the same caps/approval as typed writes; destructive-op (DELETE / status DELETE) classification tests (A3 flagged TikTok DELETE misclassified as non-destructive).
- **Complexity:** L
- **Acceptance:** no generic API tool can make a status/targeting/destructive change that bypasses the caps and approval applied to typed writes.
- **Traces:** C7-02, A1-01, A3, A8-01, K2 (attempt 9), A9-01.

### R0-04 — Fix currency unit integrity (zero- and three-decimal currencies)
- **Problem:** the Meta budget conversion is hard-coded 2-decimal: `translate.ts` `budgetInput` sends `Math.round(micros / 10_000)` cents and `meta/src/provider.ts:20` `CENTS_TO_MICROS = 10_000`. For a zero-decimal currency (JPY/KRW) this writes a **100× budget**; for a 3-decimal Gulf currency (KWD/BHD/OMR) it under-sets ~10×.
- **Why it matters:** a 100× live budget write is the audit's one latent P0 (K1); the Arabic-first/Gulf positioning makes the 3-decimal case a direct target-market hazard.
- **Depends on:** none (but only exploitable once a live write reaches a non-2-decimal account, so it must land before any live write — R4-01).
- **Files/subsystems:** `platform/apps/cloud/lib/markting/translate.ts:107` (and the full `budgetInput` switch), `platform/packages/meta/src/provider.ts` (`CENTS_TO_MICROS` and every `*_budget_cents` multiply), all provider budget mappers.
- **Architecture impact:** introduce an explicit currency-exponent lookup; carry declared currency+exponent on every `BudgetDelta`/`ReportRow` (today Google/X/others never set currency).
- **Security impact:** removes the unsafe-ad-execution 100×/10× write (P1-latent / P0-raw).
- **Data migration:** none (compute-path fix); may add a currency-exponent reference table.
- **Test requirements:** unit tests for JPY (0-decimal), USD/EUR (2), KWD/BHD (3) producing the correct minor-unit budget; a cap test keyed on the exponent.
- **Complexity:** M
- **Acceptance:** a budget write in any supported currency produces the exact minor-unit amount for that currency's exponent; a write to an account whose currency exponent is unknown fails closed.
- **Traces:** cluster #7 (A16 F-01, A1, A15-01, K1-05, K5-10).

### R0-05 — Assert object ownership on typed writes
- **Problem:** typed `meta_set_budget` / `meta_set_lifetime_budget` / `meta_set_campaign_status` / `meta_set_ad_set_status` POST to the object id without checking it belongs to `account_id`; `assertObjectOwnedByAccount` is called only on the generic path (`provider.ts:319-341` skip it vs `:379/:394`).
- **Why it matters:** a `tools:write` holder (or a proposal routed to the wrong object id) can mutate an object in a different account on the same connection — a cross-object / potential cross-tenant write.
- **Depends on:** R0-02.
- **Files/subsystems:** `platform/packages/meta/src/provider.ts` (typed write handlers), and the equivalent ownership assertion on every provider's typed writes.
- **Architecture impact:** ownership assertion becomes mandatory on all write handlers, typed and generic.
- **Security impact:** closes A16 F-02 (P0-raw / P1-adjudicated-latent).
- **Data migration:** none.
- **Test requirements:** test that a typed write to an object not owned by `account_id` is rejected before the provider call.
- **Complexity:** S
- **Acceptance:** every typed write asserts object→account ownership before issuing the provider mutation.
- **Traces:** A16 F-02, A1-01, K9 F-02, K4.

### R0-06 — Re-check budget/delta caps at apply time
- **Problem:** budget/delta rails are enforced only at validate time; apply re-plans against the fresh budget and never re-checks, giving a TTL-length bypass window. Snapchat/A4 and Reddit/A9 add cap-bypass variants (no existing campaign budget → `fromMicros` undefined → 25% delta rail skipped).
- **Why it matters:** an approved pending can execute a larger-than-approved change if the account budget moved, or if the entity had no prior budget — a financial-risk bypass of the core rail.
- **Depends on:** R0-01 (apply seam), R0-04 (correct units for the cap).
- **Files/subsystems:** `platform/packages/core/src/policy/policy.ts:19`, `engine.ts:87,110,143`.
- **Architecture impact:** caps become a property of apply, not only validate.
- **Security impact:** closes SEC-07 (P2).
- **Data migration:** none.
- **Test requirements:** test that a budget that moved between validate and apply is re-checked; test for no-prior-budget entity (absolute cap applies).
- **Complexity:** M
- **Acceptance:** the delta and absolute caps are re-evaluated against live state at apply; a no-prior-budget entity is bounded by the absolute cap.
- **Traces:** cluster #8 (C13, SEC-07, E10, A4-01, A9).

### R0-07 — Per-org isolation of the engine report index, report files, and conversation prose
- **Problem:** the engine report index/files surface is one global index with one token and one lock; `app/api/reports/engine/route.ts` authenticates the session but calls `engineClient().listReports()` with **no org dimension** — any org lists/downloads every org's runs (J2 proved it at runtime). Separately, `/conversation_history` writes a tenant's verbatim prompts readable by other threads on a shared process, and the deepagents summarization middleware offloads evicted chat prose to a shared filesystem root.
- **Why it matters:** P2 today only because every org sees identical fixtures; **latent P0** the instant the engine serves real tenant data. The conversation-prose sub-path is confidential-content leakage today independent of fixtures (K2 leans P1-now on it).
- **Depends on:** R0-08 (engine multi-tenant identity is the mechanism).
- **Files/subsystems:** `services/engine-demo/serve_demo.py:355-374`, `app/api/reports/engine/route.ts:16-24` + `[name]/route.ts`, engine report index file, `serve_demo/local.py:28-50`, vendored `deepagents/graph.py:886-889` summarization root.
- **Architecture impact:** every engine memory surface (report index, files, conversation history, summarization scratch) must carry an org dimension; the single-file global index must be replaced with per-org storage.
- **Security impact:** closes SEC-01 (reports IDOR, P1/latent-P0) and the C5-01/K2-P1-04 cross-thread prose leak.
- **Data migration:** partition existing report index/files by org; scope conversation history and summarization scratch per org/thread.
- **Test requirements:** two-caller cross-tenant probe (org B cannot list/download org A's run) in CI; cross-thread prose-read negative test.
- **Complexity:** L
- **Acceptance:** no org can enumerate or download another org's reports, conversation history, or summarization scratch; verified by an in-CI two-tenant probe.
- **Traces:** cluster #1 (J2 VERIFIED_RUNTIME, SEC-01, E1/E4/E5/E11, D4/D8, F4), cluster #11 (C5-01, K2-P1-04).

### R0-08 — Decide and specify the engine multi-tenant model `[PRODUCT DECISION]`
- **Problem:** the engine is a single process with one `caller_ref` (`adport-bridge`) for all tenants, per-process scripted/model state, one global asyncio lock serializing all report runs, and a single-file report index — a tenant-blind SPOF. Engine-side ownership checks are tautological because every tenant is one caller.
- **Why it matters:** this decision constrains R0-07 (isolation), R3-01/R3-02 (tenant context + live data), and R7-01 (multi-replica). It must be made before any second tenant's real data or a second replica.
- **Depends on:** none — this is a decision item; its implementation threads through R0-07, R3, R7.
- **Files/subsystems:** `engine/.../runtime/*`, `services/engine-demo/serve_demo.py`, `docker-compose.yml`, `engine-client.ts`.
- **Architecture impact:** defines per-tenant identity (caller_ref per org), per-thread serialization, externalized shared state (report index, kill switch, checkpoints) — the backbone of the whole later roadmap.
- **Security impact:** removes the tenant-blind caller that makes isolation a single-layer convention (K3-08=C4).
- **Data migration:** externalized state store schema (per-org report index, durable kill switch).
- **Test requirements:** architecture decision record + an isolation conformance test suite that later phases run against.
- **Complexity:** M (decision; implementation cost is in R0-07/R3/R7)
- **Acceptance:** a written, ratified decision covering per-tenant identity, per-thread serialization, and state externalization, with an isolation test contract the later phases must satisfy. Keep the fixture-only fail-closed default (R0-12) until this is implemented and a second replica/live mode is approved.
- **Traces:** cluster #5 (C4, K3-08, K2-P2-01), K3 Phase-0 decision 3, D11.

### R0-09 — Resolve the two-Postgres split-brain and establish forward-only migrations `[PRODUCT DECISION]`
- **Problem:** the system runs two Postgres instances (Supabase cloud DB + engine `pma_*` DB) with no reconciliation, and the only scripted apply path is the **destructive** `supabase db reset --local --yes` on every `make up` (`Makefile:27,33`). There is no production migration runbook.
- **Why it matters:** a destructive reset in any non-local context is data loss; the split-brain is a consistency/migration hazard that every later data change inherits.
- **Depends on:** none (foundational decision).
- **Files/subsystems:** `Makefile:25-33`, `platform/supabase/migrations/*`, engine `pma_*` schema, `docker-compose.yml`.
- **Architecture impact:** defines the system of record per data domain and a forward-only migration pipeline for both DBs.
- **Security impact:** none directly; removes a data-loss foot-gun.
- **Data migration:** replace `db reset` on the production path with forward-only migrations; add a runbook.
- **Test requirements:** migration-apply test against a clean DB in CI (R0-10); no destructive reset reachable from a production target.
- **Complexity:** M
- **Acceptance:** `make up` / the production start path never runs a destructive reset; both DBs have forward-only migrations with a documented runbook; CI applies them against a clean DB.
- **Traces:** K3 Phase-0 decision 4, H5-02/H5-03, D5.

### R0-10 — Stand up root CI with a drift check and the missing authz/concurrency/DB suites
- **Problem:** there is **no CI at the monorepo root**; the vendored `platform/.github` and `engine/.github` workflows are inert, and `make test` runs ~63 of 500+ cases, omitting the policy-engine, DB, concurrency, route-authz, typecheck, and build suites. No CI runs any audited command. The engine host also binds ~10 private/test-only upstream symbols with no drift check.
- **Why it matters:** every Phase-0 fix (R0-01..R0-07) needs a regression guard that actually runs; without CI, "tests pass" (the green `make test`) is not evidence of safety.
- **Depends on:** R0-01..R0-07 (supplies the suites CI must run), R0-09 (clean-DB migration lane).
- **Files/subsystems:** new `/.github/workflows/`, `Makefile` test target, engine upstream-symbol binding, `pnpm`/`uv` lanes.
- **Architecture impact:** a single root CI with DB + cross-stack lanes; an upstream-edit drift check (engine is byte-identical to import commit `4162146` — a drift check preserves that).
- **Security impact:** enables dependency/secret scanning (R1-07) and runs the cross-tenant/authz probes (R0-02, R0-07).
- **Data migration:** none.
- **Test requirements:** CI runs policy-engine, DB (cross-tenant isolation), concurrency (double-apply), route-authz, typecheck, build, engine pytest **against a clean workspace** (no stray `KILL_SWITCH`), and the upstream drift check.
- **Complexity:** M
- **Acceptance:** every audited command runs in CI on push/PR; a stray `engine/workspace/KILL_SWITCH` cannot inflate failures (clean-workspace lane); an unreviewed edit to a vendored engine file fails the drift check.
- **Traces:** cluster #12 (F1/K6-05, C6), H2-01/H2-02, E9-02/E9-03, F8-01, F9, F2-02, K3 Phase-0 decision 5.

### R0-11 — Encode the data-trust floor in code before any surfaced confidence
- **Problem:** on the live path every gate meant to say "this number is not settled/reconciled/comparable yet" is off, tautological, or prose-only: live data enters at trust tier T1 but is rendered with T3/T4 confidence. Partial-conversion/partial-impression ratios emit authoritative CPA/ROAS up to ~3.5× wrong; `reconciled:true` is hardcoded/tautological; `ATTRIBUTION_DIFFERS` is defined but never set; cross-platform blended CPA/ROAS mixes incompatible attribution; no significance/sample-sufficiency engine exists (a 2→3-conversion day is flagged as a signal).
- **Why it matters:** the moment live data reaches the model/reports (R3-02), every surfaced number inherits unearned confidence and drives real budget decisions. The floor must exist in code *before* live data, not after.
- **Depends on:** none (pure compute layer); gates R3-02 and all of R4.
- **Files/subsystems:** `engine/.../tools/compute.py`, `normalize.py`, `compare_periods.py`, `domain/common.py:64` (`ATTRIBUTION_DIFFERS`), `summary.py`, `render.py`, `reads.ts`.
- **Architecture impact:** implements K5's 9-rule floor — explicit gating trust tier, earned reconciliation, maturity gate, ratio integrity, sample-sufficiency floor, attribution-compatibility gate, evidence linkage on proposals, currency/unit integrity, synthetic isolation.
- **Security impact:** none directly (data-correctness/trust).
- **Data migration:** none.
- **Test requirements:** tests that partial-window ratios are suppressed or flagged, that `reconciled` requires real provider totals, that `ATTRIBUTION_DIFFERS` fires on mixed windows, that below-threshold sample sizes carry no confidence, and that synthetic data is isolated from live tiers.
- **Complexity:** L
- **Acceptance:** no surfaced number carries a confidence score unless it passes the 9 rules; partial/incompatible/under-sampled figures are suppressed or explicitly flagged in the human report, not just footnoted.
- **Traces:** K5 (9-rule floor, K5-01/K5-10), B1-02, B3, B8, B9, A13-01, A12-04, deliverable 10.

### R0-12 — Keep the fixture-only fail-closed default and gate alias→real-account binding `[PRODUCT DECISION]`
- **Problem:** the engine host's refusal to boot with live credentials / non-sample data is the single property that makes every latent P0 latent. There is also no UI/safe path to bind an engine alias to a real account (`markting_account_aliases`), so a proposal cannot reach a real account today — which is currently a safety feature, not only a gap.
- **Why it matters:** this is the explicit decision to *keep* the safe default until R0-01..R0-11 are met, and to make alias→real-account binding a deliberate, gated step (it is the switch that converts latent P0s into live ones).
- **Depends on:** gates R3-02 (live data) and R4-01 (working write loop).
- **Files/subsystems:** `services/engine-demo/serve_demo.py` (`assert_fail_closed`, `demo_settings`), `markting_account_aliases` (no writer today), kill-switch path.
- **Architecture impact:** alias binding becomes an explicit, audited, human-gated operation behind the Phase-0 exit gate.
- **Security impact:** preserves the fail-closed posture that caps today's severities at P1/P2.
- **Data migration:** define the alias table writer and its authorization (later implemented in R4-01).
- **Test requirements:** test that the host still refuses to start in an unsafe configuration; test that no alias binding is possible until the gate is lifted.
- **Complexity:** S
- **Acceptance:** the fixture-only fail-closed default stays in force until Phase 0 exits; binding an alias to a real account is impossible except through an explicit, audited, human-gated path.
- **Traces:** C2 (K3-03 arch map §12), cluster #4 (C3-01, K2-P1-03, K7-01), K3 Phase-0 decisions 6–7.

---

## Phase 1 — Production hardening (operate as a real service)

**Entry:** Phase 0 exited. **Theme:** the repo's own `docs/TODO.md:18-22` / `deployment-model.md:49-58` blockers before a first paying customer (K8's B1–B9). These do not need the AI to be intelligent; they need the service to be operable, recoverable, and observable.

### R1-01 — Backup and restore for both DBs and the engine workspace volume
- **Problem:** no automated backup/restore exists for the cloud DB, engine Postgres, or the engine workspace volume.
- **Why it matters:** no recovery path for tenant data, approvals, or encrypted credentials — a launch blocker.
- **Depends on:** R0-09 (system-of-record decision), R1-02 (a backup is non-restorable without the key).
- **Files/subsystems:** `docker-compose.yml`, `Makefile`, both Postgres instances, engine workspace volume.
- **Architecture impact:** scheduled backups + a tested restore drill.
- **Security impact:** backups must be encrypted and key-escrowed (R1-02).
- **Data migration:** none.
- **Test requirements:** a restore drill (NOT_VERIFIED in the audit; must be closed in staging).
- **Complexity:** M
- **Acceptance:** both DBs and the workspace volume have automated backups and a documented, exercised restore drill.
- **Traces:** H6-B1, K8-B1.

### R1-02 — KMS/escrow for the master encryption key and working key rotation
- **Problem:** `ADPORT_CLOUD_ENCRYPTION_KEY` is a single symmetric key in env with no KMS/escrow; rotation is prescribed (`deployment-model.md:45`, `key_version` column exists) but `repository.ts:162` hardcodes `key_version=1` and crypto never rotates.
- **Why it matters:** a DB backup is non-restorable if the key is lost, and the key cannot be rotated — a confidentiality and recoverability blocker.
- **Depends on:** none.
- **Files/subsystems:** `platform/apps/cloud/lib/crypto.ts:5-9`, `repository.ts:162`, env/secret management.
- **Architecture impact:** KMS-backed key management with versioned rotation.
- **Security impact:** removes single-key-in-env risk; enables rotation.
- **Data migration:** re-encrypt or dual-key-read during rotation; honor `key_version`.
- **Test requirements:** rotation test (old and new `key_version` both decrypt during the window).
- **Complexity:** L
- **Acceptance:** the master key lives in a KMS with escrow; a rotation can be performed with no downtime and `key_version` is honored end-to-end.
- **Traces:** H6-B2, K8-B2, E3.

### R1-03 — TLS edge
- **Problem:** the shipped compose stack serves plain HTTP; no TLS edge, no HSTS.
- **Why it matters:** credentials and tenant data in cleartext — a launch blocker.
- **Depends on:** none.
- **Files/subsystems:** `docker-compose.yml`, reverse-proxy/edge config, CSP/HSTS headers (`E1` P3 CSP `unsafe-inline`).
- **Architecture impact:** a TLS-terminating edge in front of cloud and engine.
- **Security impact:** encrypts transport; add HSTS and tighten CSP (nonce).
- **Data migration:** none.
- **Test requirements:** edge config smoke test.
- **Complexity:** S
- **Acceptance:** all external traffic is TLS; HSTS set; CSP nonce replaces `unsafe-inline`.
- **Traces:** H1, K8-B6, E1 (CSP/HSTS P3).

### R1-04 — Graceful shutdown and connection-pool drain
- **Problem:** uvicorn runs with defaults, no FastAPI lifespan, Postgres/checkpointer pools never closed — rolling deploys drop in-flight turns.
- **Why it matters:** deploys mid-chat/mid-apply can orphan runs or corrupt state; conditional on operating as a real service.
- **Depends on:** R1-08 (async job model makes drain meaningful).
- **Files/subsystems:** `services/engine-demo/serve_demo.py`, `engine/.../surfaces/api/app.py`, pool lifecycle.
- **Architecture impact:** lifespan hooks + drain on SIGTERM.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** shutdown-drain test (in-flight request completes or is safely requeued).
- **Complexity:** S
- **Acceptance:** SIGTERM drains in-flight work and closes pools cleanly.
- **Traces:** H4-B8, K8-B8.

### R1-05 — Cluster-safe shared state: externalize the report index and kill switch
- **Problem:** the report index is one global JSON file guarded by an in-process lock, and the kill switch is a per-process local file that neither propagates across replicas nor survives a fresh container.
- **Why it matters:** the core write-safety control (kill switch) can be silently lost on scale-out, and the report index corrupts under concurrent replicas — conditional on scaling / live writes.
- **Depends on:** R0-08 (externalized-state decision), R0-07 (per-org index).
- **Files/subsystems:** engine report index, kill-switch path (`serve_demo.py` `engage_kill_switch`), shared state store.
- **Architecture impact:** move index and kill switch to shared, durable, org-scoped storage.
- **Security impact:** the kill switch becomes a reliable cross-replica control.
- **Data migration:** migrate the file index to the shared store.
- **Test requirements:** kill-switch-propagation test across two replicas; concurrent index-write test.
- **Complexity:** M
- **Acceptance:** engaging the kill switch halts writes on every replica; the report index is correct under concurrent access.
- **Traces:** H4-B9, K8-B9, cluster #1.

### R1-06 — Observability floor: structured logs, metrics, tracing, and an audited apply step
- **Problem:** the actual ad-platform write (apply) is the least observable step — no audit row, no structured log, no metric; no metrics exist anywhere; engine logs are unstructured plaintext with no correlation/tenant ids; no trace/correlation id; no token/cost accounting.
- **Why it matters:** you cannot safely run real ad spend you cannot observe or reconstruct; incident response and metering (R2) both depend on this.
- **Depends on:** R0-10 (CI), R0-08 (tenant identity for log/trace fields).
- **Files/subsystems:** `lib/cloud/reads.ts`, `lib/http.ts`, engine middleware (`redaction.py`, `cli.py`), apply route, `RunOutcome`.
- **Architecture impact:** structured logging with correlation + tenant ids, a metrics pipeline, tracing, and a durable apply audit event.
- **Security impact:** apply becomes auditable; redaction list must cover all credentials (E3 gap: X/OpenAI adapter creds and model keys omitted).
- **Data migration:** add an apply audit-event table if absent.
- **Test requirements:** test that every apply writes an audit event; redaction coverage test.
- **Complexity:** L
- **Acceptance:** every apply emits a structured, correlated, tenant-tagged audit event and metric; traces are available; no secret appears in logs.
- **Traces:** H3-01/H3-02/H3-03, C12-01/C12-02/C12-03, E3, cluster #9 (C11).

### R1-07 — Supply-chain and container hardening
- **Problem:** `apps/cloud` pins `next@16.3.1` with 3 critical RCEs (patched ≥16.3.6); no dependency/secret scanning runs; the cloud build has no `platform/.dockerignore` so `COPY . .` pulls `apps/cloud/.env.local` (real secrets) into the image; the engine container runs as root.
- **Why it matters:** a known-RCE web surface and secret-baking are direct launch blockers; root containers widen blast radius.
- **Depends on:** R0-10 (CI to run the scanners).
- **Files/subsystems:** `platform/package.json`/`pnpm-lock.yaml`, `infra/cloud.Dockerfile`, new `platform/.dockerignore`, engine Dockerfile `USER`.
- **Architecture impact:** CI dependency/secret/image scanning; non-root engine container.
- **Security impact:** closes SEC-04 (Next.js RCE, P1 — reachability NOT_VERIFIED, escalates to P0 if a vulnerable route is reachable) and the secret-in-image leak.
- **Data migration:** none.
- **Test requirements:** `pnpm audit` / `pip-audit` / image scan + gitleaks in CI; a build test proving `.env.local` is excluded.
- **Complexity:** M
- **Acceptance:** Next.js patched; CI fails on critical vulns/secrets; the built image contains no `.env*`; the engine container runs non-root.
- **Traces:** E9-01/E9-02, H1, K8-B7 (CI dependency), SEC-04.

### R1-08 — Asynchronous job model for chat turns and report runs
- **Problem:** every long operation (chat turn, report run, apply, webhook, deletion) is synchronous inside an HTTP request; the chat turn is a minutes-long sync call with no queue, idempotency key, engine-side timeout, cancellation, or health gating; a client abort orphans the run; `maxDuration` is a no-op on the standalone server.
- **Why it matters:** sync multi-minute requests do not survive deploys, retries, or scale; they are the root of orphaned runs and duplicate hand-offs.
- **Depends on:** R0-01 (idempotency), R0-08 (per-thread serialization), R1-06 (observability).
- **Files/subsystems:** `lib/markting/engine-client.ts`, `assistant.ts`, `app/api/assistant/messages/route.ts`, `app/api/reports/engine/route.ts`, engine report lock.
- **Architecture impact:** a job/queue/worker model with idempotency, cancellation, per-request deadlines, and health gating; the single global report lock is removed.
- **Security impact:** reduces orphaned-write/duplicate-hand-off windows.
- **Data migration:** a jobs table.
- **Test requirements:** idempotent re-submit test; cancellation test; deadline test; no cross-tenant lock contention.
- **Complexity:** XL
- **Acceptance:** chat and report runs execute as idempotent, cancellable jobs with deadlines and health gating; a client abort cannot orphan a run; no single global lock serializes all tenants.
- **Traces:** D1, D7, D9, cluster #9 (C11, K2-P2-03), G2.

### R1-09 — Retention and deletion cover the markting tables and engine memory
- **Problem:** the retention cron does not prune the markting bridge tables (incl. an unbounded JSONB provenance log) or engine memory (LangGraph checkpoints, `pma_dedupe` grow forever); org deletion cascades away its own `deletion_requested` audit row and does not reach engine-side memory.
- **Why it matters:** data-retention commitments and deletion requests are not honored end-to-end — a compliance/contractual blocker once real tenant data exists.
- **Depends on:** R0-08 (engine identity to scope deletion), R0-09 (migration pipeline).
- **Files/subsystems:** retention cron, `markting_*` tables, engine `pma_*` + checkpoints, org-deletion path (`D5`).
- **Architecture impact:** a single retention/deletion policy spanning both DBs and engine memory.
- **Security impact:** honors deletion/retention across every store.
- **Data migration:** add pruning for markting + engine tables; fix the deletion audit-row cascade.
- **Test requirements:** retention-prune test for each table; deletion-propagation test to engine memory.
- **Complexity:** M
- **Acceptance:** retention and deletion apply to every store holding tenant data, including engine memory; a deletion request leaves no tenant data or orphaned audit gap.
- **Traces:** H5-01, H5-02, C4, D5, K2 (gap 7).

### R1-10 — Stripe webhook ordering and billing lifecycle
- **Problem:** the Stripe webhook verifies signatures and dedups by id but has no event-ordering guard (out-of-order delivery mis-sequences subscription state); dedup SELECT/process/INSERT are three non-transactional statements (TOCTOU); churned orgs cannot re-subscribe in-app (`provider_subscription_id` persists).
- **Why it matters:** mis-sequenced billing events can grant or revoke the wrong entitlements; a financial-integrity risk.
- **Depends on:** R0-09 (transactional migration discipline).
- **Files/subsystems:** `app/api/billing/webhook/route.ts`, `lib/cloud/billing.ts`, `billing_events` schema, `startSubscription`.
- **Architecture impact:** transactional dedup+process+record; event-version/ordering column; re-subscribe path.
- **Security impact:** none directly.
- **Data migration:** add an event-version/created-at column to `billing_events`.
- **Test requirements:** out-of-order delivery test; concurrent-webhook TOCTOU test; re-subscribe-after-cancel test.
- **Complexity:** M
- **Acceptance:** out-of-order/duplicate Stripe events cannot mis-sequence entitlements; a fully-canceled org can re-subscribe in-app.
- **Traces:** E8, I3 (re-subscribe P2).

---

## Phase 2 — AI Gateway (govern, meter, and observe the model)

**Entry:** Phase 0 exited, R1-06 (observability) done. **Theme:** K2's layer 1, the AI Gateway — ship the Option-A safety items unconditionally; the self-hosted Option-B gateway is required at multi-tenant live. This phase makes live-model use affordable, bounded, and observable **before** any tenant data reaches the model (Phase 3).

### R2-01 — AI gateway with metering, quota, caching, and token capture
- **Problem:** there is no fallback routing, circuit breaker, cost accounting, per-org quota, model allowlist, tracing, or caching anywhere; the only governor is a flat 120 req/min rate limit. Token/cost is never captured (`RunOutcome` carries no tokens/latency).
- **Why it matters:** the dominant variable cost (AI inference) is unbilled and uncapped; heavy automation is unpriced; one tenant can exhaust shared budget.
- **Depends on:** R1-06 (observability floor), R0-08 (per-org identity for quota).
- **Files/subsystems:** `engine/.../config.py`, `assembly.py`, `middleware/*`, a new gateway layer, `RunOutcome`.
- **Architecture impact:** a governed AI gateway (self-hosted at multi-tenant live) in front of all model calls; per-org metering, quota, caching, token capture.
- **Security impact:** per-org isolation of quota and cost.
- **Data migration:** metering/token-ledger tables (shared with R2-03).
- **Test requirements:** per-org quota enforcement test; token-capture test; cache-hit test.
- **Complexity:** L
- **Acceptance:** every model call is metered with tokens/latency/cost attributed to an org, bounded by a per-org quota, and cacheable; a self-hosted gateway path exists for multi-tenant live.
- **Traces:** C2-03, C10, C12-02, I3-01, cluster #6 (I3-01/K8-B3), K2 (layer 1).

### R2-02 — Model allowlist, fallback routing, circuit breaker, per-request deadline
- **Problem:** model-provider outages surface as HTTP-200 prose ("Model call failed after N attempts…"); the retry middleware retries ALL non-model exceptions 3× with stacked SDK retries and no wall-clock cap.
- **Why it matters:** silent failures masquerade as answers, and deterministic/config errors are retried pointlessly — a reliability defect that also inflates cost.
- **Depends on:** R2-01 (gateway is where routing lives), R1-06.
- **Files/subsystems:** `engine/.../assembly.py`, `middleware/timeout.py`, retry middleware, `config.py`.
- **Architecture impact:** a model allowlist, fallback routing, circuit breaker, and a per-request wall-clock deadline in the gateway.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** test that a model failure surfaces as an error (not 200 prose); test that non-retryable errors are not retried; deadline test.
- **Complexity:** M
- **Acceptance:** model failures surface as explicit errors; only retryable errors retry, with a bounded wall-clock deadline; a failed primary falls back within the allowlist.
- **Traces:** C11-01/C11-02/C11-03, C2-03, cluster #9.

### R2-03 — Usage-metering tables and an AI-cost ledger (enables usage-based billing)
- **Problem:** no usage-metering tables or AI-cost ledger exist; pricing is 5 flat dimensions that capture none of the AI/engine cost drivers, so usage-based or hybrid billing is impossible.
- **Why it matters:** the business cannot price the product's dominant cost; this is the data substrate for Phase 7 billing.
- **Depends on:** R2-01 (token capture feeds the ledger).
- **Files/subsystems:** new metering/ledger tables, `lib/cloud/billing.ts`, `plans.ts`.
- **Architecture impact:** an append-only usage ledger keyed by org and cost driver (AI runs, report runs, tokens, managed accounts).
- **Security impact:** none.
- **Data migration:** metering/ledger schema.
- **Test requirements:** ledger-write-per-run test; aggregation/rollup test.
- **Complexity:** M
- **Acceptance:** every AI/engine run writes a per-org usage ledger entry sufficient to support usage-based or hybrid billing (implemented in R7-04).
- **Traces:** I1-01/I1-02, I3-01, I5, K8-B3.

---

## Phase 3 — Intelligence Layer (tenant context and live data to the model)

**Entry:** Phase 0 exited (R0-08 engine identity, R0-11 data-trust floor, R0-12 gate), Phase 2 done. **Theme:** K2's layer 2 — deliver tenant-scoped context via a new engine context field and, only behind the Phase-0 gate, a live tenant-data read path. **This is the phase that lifts the fixture-only default, so it may not begin until Phase 0 exits.**

### R3-01 — Per-turn tenant/business/locale context to the model (new engine context field)
- **Problem:** the adport→engine request is `{text}` only; org/user identity, locale, currency, goals, and business truth never reach the model.
- **Why it matters:** the "AI media buyer" reasons with zero knowledge of whose accounts, which market, which currency, or which goals — the core intelligence is impossible without this.
- **Depends on:** R0-08 (per-tenant identity), R2-01 (gateway/metering).
- **Files/subsystems:** `engine-client.ts:114-116`, engine `api/app.py` request schema, a new structured context field, `instructions.md`.
- **Architecture impact:** a tenant-scoped context contract threaded from adport through the bridge into the model.
- **Security impact:** context must be org-scoped and not leak across tenants (depends on R0-07).
- **Data migration:** none (request-schema change).
- **Test requirements:** test that the model receives org/locale/currency/goal context; cross-tenant context-isolation test.
- **Complexity:** M
- **Acceptance:** every turn carries validated per-tenant business/locale/currency/goal context to the model, org-scoped.
- **Traces:** C3-01, cluster #4 (K2-P1-03), C9, C14.

### R3-02 — Live tenant-data read path to the engine
- **Problem:** the engine is pinned to sample fixtures in every mode and refuses live credentials, so the model analyzes three USD fixtures, never the tenant's accounts.
- **Why it matters:** this is the single disqualifying fact behind "not an intelligent media-buying OS"; without it no persona gets core value.
- **Depends on:** R0-07 (per-org isolation), R0-08 (identity), R0-11 (trust floor), R0-12 (gate lift), R3-01 (context).
- **Files/subsystems:** `serve_demo.py` (`assert_fail_closed`/`demo_settings` sample pin), engine data-mode path, Pipeboard/direct adapters, `config.py:158`.
- **Architecture impact:** a per-org live read path replacing the forced sample pin, behind the Phase-0 gate; the trust floor (R0-11) classifies every live figure.
- **Security impact:** converts the latent P0s (R0-07, R0-04) into live exposure if any are unmet — hence the hard dependency gate.
- **Data migration:** none.
- **Test requirements:** live-read integration test (per-org, isolated); trust-tier regression on live data; a live-mode canary (K6).
- **Complexity:** XL
- **Acceptance:** the model analyzes the authenticated tenant's own accounts, org-scoped, with every figure gated by the R0-11 trust floor; the fixture-only default remains available and is the fallback on any safety-gate failure.
- **Traces:** cluster #4 (C1-01, C3, K1 gap 1, K7-01, J1/J2/J3/J4/J5/J6), K2-P1-03.

### R3-03 — Economics / business-truth layer
- **Problem:** every "revenue"/ROAS figure is ad-platform-attributed `conversion_value`; no store revenue, orders, refunds, COGS, margin, CAC, MER, LTV, or FX concept exists. CPA is conflated with CAC. The merchant overview ROAS tile is structurally 0×.
- **Why it matters:** the single largest strategic gap (K1 gap 2); without business truth the system optimizes a platform-reported proxy, not profit.
- **Depends on:** R3-02 (live data), R0-11 (trust floor / attribution gate).
- **Files/subsystems:** `engine/.../tools/compute.py`, `domain/metrics.py`, `reads.ts:54`, `live-data.tsx:34-41`, new store/revenue ingestion.
- **Architecture impact:** a business-truth layer (store revenue, orders, COGS, margin, CAC, MER, FX) feeding the model and reports; A12's profit tiers gate "profitable/incremental" wording.
- **Security impact:** none directly.
- **Data migration:** store/revenue/cost tables per org.
- **Test requirements:** profit-tier gating tests; FX/currency aggregation tests; ROAS-tile correctness.
- **Complexity:** XL
- **Acceptance:** the system can express spend→revenue→margin→MER/CAC with correct FX, and no figure claims "profitable/incremental" above its earned tier.
- **Traces:** A12, B6, K1 gap 2, A16 F-21, cluster-adjacent K5.

### R3-04 — Attribution integrity before any blending
- **Problem:** attribution is never a gate in code (`ATTRIBUTION_DIFFERS` defined, never set); cross-platform totals sum conversions across incompatible windows with no suppression; conversion-definition conflation (purchases-only normalization).
- **Why it matters:** blended CPA/ROAS over incompatible attribution is a wrong number driving budget decisions (K5-resolved P2); must be correct before decision intelligence (R4).
- **Depends on:** R0-11 (trust floor), R3-02 (live data).
- **Files/subsystems:** `domain/common.py:64`, `compute.py`, `normalize.py:28,131`, `render.py:123-134,166-172`.
- **Architecture impact:** an attribution-compatibility gate that suppresses or flags blended figures across incompatible models/windows.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** test that `ATTRIBUTION_DIFFERS` fires and suppresses blended totals; conversion-definition normalization tests per objective.
- **Complexity:** L
- **Acceptance:** no blended CPA/ROAS is surfaced across incompatible attribution without an explicit, figure-level flag; conversion definitions are objective-correct.
- **Traces:** A13, B2, K5-01, A12-04.

### R3-05 — Arabic and regional reasoning, reports, and glossary
- **Problem:** Arabic chrome is production-grade, but the AI's own output (analysis, proposals, reports) is English; there is no Arabic/Gulf doctrine, no Ramadan/Eid/holiday/locale-weekend awareness; the glossary needs a native reviewer; one functional defect (UTC approval-expiry misread by the Riyadh offset).
- **Why it matters:** the product is positioned Arabic-first for MENA; the brain is not.
- **Depends on:** R3-01 (locale context), R3-02 (live data).
- **Files/subsystems:** `instructions.md`, `SKILL.md`/wiki, `middleware`, report composer/`render.py`, i18n glossary, approval-expiry local-time handling.
- **Architecture impact:** Arabic reasoning/report doctrine and regional seasonality as first-class model inputs.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** Arabic output tests (RTL, digits, plurals in generated prose); Ramadan/Eid awareness test; local-time expiry test.
- **Complexity:** L
- **Acceptance:** analysis/proposals/reports render correct Arabic for Arabic-locale tenants with regional seasonality awareness; approval expiry is shown in the tenant's local time.
- **Traces:** C8, G3, B4 (Ramadan/Eid), K7 (Arabic), K7 (UTC expiry).

---

## Phase 4 — Recommendation engine (single human-gated, metered, observable write pipeline)

**Entry:** Phase 0 exited, Phase 3 delivered (tenant data + business truth + attribution). **Theme:** K2's layer 4 — one recommendation pipeline, human-gated (R0-02), metered (R2), observable (R1-06), with the engine risk classifier mirrored on the adport write path (R0-03) and the generic API tools retired.

### R4-01 — Working write loop (alias binding + end-to-end live proposal→approval)
- **Problem:** in live mode no UI writes `markting_account_aliases`, so a proposal is `unsupported`/orphaned; the only AI→write path is unusable in production.
- **Why it matters:** without this the recommendation engine cannot act, even after Phase 3; it is the keystone of the product's value.
- **Depends on:** R0-01, R0-02, R0-03, R0-04, R0-05, R0-06, R0-12 (gated alias binding), R3-02.
- **Files/subsystems:** `markting_account_aliases` (new writer + UI), bridge `translate.ts`/`bridge.ts`, apply routes.
- **Architecture impact:** an audited, human-gated alias-binding flow and a complete live proposal→preview→approval→apply loop.
- **Security impact:** alias binding is the switch from latent to live P0s — it inherits every Phase-0 safety gate.
- **Data migration:** alias table writer + provenance.
- **Test requirements:** end-to-end live write-loop test (proposal→approval→apply→reconcile) with all Phase-0 guards active.
- **Complexity:** L
- **Acceptance:** a tenant can bind an alias and take a proposal to an applied, reconciled write with four-eyes, caps, correct currency, ownership assertion, and atomic consume all enforced.
- **Traces:** G1 (P1), K7-02, cluster #4, C2 arch.

### R4-02 — Decision intelligence (budget/allocation/marginal-ROAS/saturation)
- **Problem:** no budget optimization/scaling/allocation/marginal-ROAS/saturation logic exists; the demo "recommendation" is a hard-coded `g-103→240`.
- **Why it matters:** the "AI media buyer" cannot actually decide anything; recommendations are scripted.
- **Depends on:** R3-03 (business truth), R4-03 (significance).
- **Files/subsystems:** `demo_script.py` (scripted proposal), new allocation/optimization tools, `engine/.../tools/`.
- **Architecture impact:** a decision layer producing evidence-linked allocation/scaling recommendations.
- **Security impact:** none (all output is a proposal gated by R0-02).
- **Data migration:** none.
- **Test requirements:** allocation/marginal-ROAS correctness tests; saturation-curve tests.
- **Complexity:** XL
- **Acceptance:** recommendations are derived from the tenant's data and business truth, not scripted, and are evidence-linked (R4-04).
- **Traces:** A15, K1 gap 4.

### R4-03 — Significance, sample-sufficiency, and decomposition signals
- **Problem:** no statistical significance, sample-size, confidence-interval, or variance computation exists; a 2→3-conversion day is flagged as an anomaly; relative % on tiny bases looks dramatic.
- **Why it matters:** recommendations rest on noise without a significance/sample floor; a prerequisite for any confidence score (R0-11 rule 5).
- **Depends on:** R0-11 (trust floor), R3-02.
- **Files/subsystems:** `compute.py`, `compare_periods.py`, `summarize_window`, new stats layer.
- **Architecture impact:** a significance/sample-sufficiency engine feeding the recommendation and report layers.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** significance tests (no signal below the sample/absolute floor); decomposition tests.
- **Complexity:** L
- **Acceptance:** no anomaly or recommendation is surfaced below the sample-sufficiency/absolute-change floor; signals carry an uncertainty measure.
- **Traces:** B3, B8, K5 (rule 5).

### R4-04 — Evidence linkage and creative/frequency/change-history tools
- **Problem:** proposals have no evidence linkage; there is no creative entity, no reach/frequency, no change-history tool, despite prompts referencing creative fatigue and a `get_creative_performance` tool that does not exist.
- **Why it matters:** an approver cannot see why a change is proposed; creative/frequency are core media-buying signals that are entirely absent.
- **Depends on:** R4-02, R3-02.
- **Files/subsystems:** engine tool catalog, provider ad-level mappers (ID-only for several providers), bridge, report layer.
- **Architecture impact:** evidence objects attached to proposals; creative/frequency/change-history as first-class tools and data.
- **Security impact:** none.
- **Data migration:** creative/change-history storage.
- **Test requirements:** proposal-evidence-linkage test; creative/frequency presence tests per provider.
- **Complexity:** L
- **Acceptance:** every proposal carries a traceable evidence chain; creative, reach/frequency, and change history are available where the provider supplies them.
- **Traces:** A14, A15, K5 (rule 7), K2 gap.

### R4-05 — Engine parity across all 11 channels
- **Problem:** the engine can reason about only 5 of 11 channels (Meta, Google, Reddit, LinkedIn, X); TikTok/Snapchat/Microsoft/Pinterest/Spotify/Apple have no engine normalization, fixture, or bridge mapping.
- **Why it matters:** the "media buyer" is blind to 6 channels it advertises support for.
- **Depends on:** R3-02, R0-11.
- **Files/subsystems:** engine `normalize.py` mappings, fixtures, `translate.ts` `PLATFORM_TO_PROVIDER`, provider adapters.
- **Architecture impact:** uniform normalization + bridge mapping across all channels.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** per-channel normalization + bridge-mapping tests; fixtures for each channel.
- **Complexity:** L
- **Acceptance:** the engine can read, normalize, and (where safe) propose writes for all 11 channels with tests.
- **Traces:** A5–A11, K1 gap 5, A6, A10.

---

## Phase 5 — Marketing Memory and the outcome loop (learning)

**Entry:** Phase 3 + Phase 4 delivered. **Theme:** K2's layers 3 & 5 — Marketing Memory in adport Postgres with human-confirmed facts (no learned value may change a limit), and an outcome loop using the dormant pending sweep.

### R5-01 — Marketing Memory (human-confirmed, per-org, non-authoritative over limits)
- **Problem:** no durable tenant memory exists; the only tenant-knowledge mechanism (company-context skill) is absent, git-ignored, deployment-global, and never created.
- **Why it matters:** the AI cannot remember a tenant's confirmed facts across turns; without it there is no personalization or learning.
- **Depends on:** R0-07 (per-org isolation), R3-01 (context), R0-08 (identity).
- **Files/subsystems:** new `markting_*` memory tables in adport Postgres, engine context assembly, company-context mechanism.
- **Architecture impact:** per-org Marketing Memory of human-confirmed facts; **a hard invariant that no learned/remembered value may change a safety limit or cap** (caps stay code-owned).
- **Security impact:** memory is strictly org-scoped; confirmed facts only.
- **Data migration:** memory schema per org.
- **Test requirements:** per-org memory isolation test; invariant test that memory cannot alter a cap.
- **Complexity:** L
- **Acceptance:** confirmed tenant facts persist per org and inform reasoning, and no memory value can relax a safety limit.
- **Traces:** C4, C5, K2 (layer 3).

### R5-02 — Outcome loop (did the approved change work?)
- **Problem:** there is no outcome/learning loop; the pending-sweep mechanism is dormant.
- **Why it matters:** the system never learns whether its approved recommendations helped — the difference between a dashboard and an operating system.
- **Depends on:** R4-01 (write loop), R5-01 (memory), R1-06 (observability).
- **Files/subsystems:** the dormant pending sweep, outcome measurement, memory write-back.
- **Architecture impact:** an outcome loop that measures post-change performance and records the result as a confirmed fact (not a limit change).
- **Security impact:** none.
- **Data migration:** outcome records.
- **Test requirements:** outcome-attribution test; loop-closure test.
- **Complexity:** L
- **Acceptance:** each applied recommendation has a measured outcome recorded and available to future reasoning.
- **Traces:** K2 gap 6, C4.

### R5-03 — Fix the latent data-correctness items the red team surfaced
- **Problem:** `compare_periods` double-counts/accepts overlapping windows; entity-coverage `INCOMPLETE_WINDOW`; the 200-row pending-scan 404; CTR fraction-vs-percent; auto-mode fixture+live mix.
- **Why it matters:** these distort comparison and coverage figures once live data and the outcome loop are active; harmless on fixtures, wrong on real data.
- **Depends on:** R3-02, R0-11.
- **Files/subsystems:** `compare_periods.py`, `normalize.py`, `compute.py`, pending-scan path.
- **Architecture impact:** correctness fixes in the compute/comparison layer.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** overlapping-window rejection test; CTR-unit test; pending-scan >200 test.
- **Complexity:** M
- **Acceptance:** period comparisons reject/flag overlap, CTR units are consistent, and pending scans cover all rows.
- **Traces:** K9-U2/U3/U4/U5, B4-05, J6.

---

## Phase 6 — Workbench and product completeness

**Entry:** Phases 0–5 delivered. **Theme:** K7's "differentiator-later" Workbench IA plus the honesty/legal/UX fixes that must land before a confident first-customer launch (several of these are P1 for the paying-customer frame but have no upstream dependency beyond a working core).

### R6-01 — Workbench information architecture
- **Problem:** the current IA makes Overview (a passive read dashboard) the hub while the Assistant (the only action-producing surface) is a secondary link; the Workbench north star is right but almost all differentiator-later.
- **Why it matters:** the IA should center the action surface once the core value exists.
- **Depends on:** R4-01 (working write loop), R3-02.
- **Files/subsystems:** `components/nav.tsx`, `shell.tsx`, dashboard pages, `07-product-ux-assessment.md`.
- **Architecture impact:** reorganize the IA around the recommendation Workbench.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** navigation/IA UI tests.
- **Complexity:** L
- **Acceptance:** the Workbench centers the action surface and maps to the delivered engine capabilities.
- **Traces:** K7 (Workbench), G5, deliverable 07.

### R6-02 — Findings in-product trigger / scheduled runs
- **Problem:** a Findings producer exists (`audit_run`→`AuditRunner.save`→`PostgresFindingsStore`), but nothing in-dashboard or scheduled invokes it, so the primary Findings nav module shows an empty table.
- **Why it matters:** a shipped primary feature appears broken; downgraded to P3 by K7 because a producer exists, but it must be wired to a trigger.
- **Depends on:** R1-08 (job model for scheduled runs).
- **Files/subsystems:** `findings/page.tsx`, `audit/runner.ts`, `context.ts:52`, `runtime.ts:145`, a scheduler.
- **Architecture impact:** a scheduled/in-product trigger for the audit runner.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** scheduled-run produces findings test.
- **Complexity:** S
- **Acceptance:** Findings is populated by an in-product or scheduled trigger.
- **Traces:** G5-01/G7-C09, K7-13 (P3).

### R6-03 — UX correctness fixes
- **Problem:** a cluster of concrete UX defects: structurally-0× ROAS tile (`conversion_value` never requested), DELETE `/api/members` client/route param mismatch (always 403), onboarding's terminal step wires an MCP client instead of the built-in Assistant, Free/reader plan strips `tools:write` so the onboarding's promised preview 403s, no org switcher, no Assistant message persistence.
- **Why it matters:** each is an immediate activation or trust failure for a real user.
- **Depends on:** R4-01 (write loop makes preview reachable), R3-03 (ROAS source).
- **Files/subsystems:** `live-data.tsx`, `reads.ts`, `app/api/members/route.ts`, `onboarding/onboarding-flow.tsx`, `plans.ts`, Assistant persistence.
- **Architecture impact:** onboarding targets the Assistant; Assistant persists messages.
- **Security impact:** none (role/scope logic stays).
- **Data migration:** Assistant message store.
- **Test requirements:** ROAS-tile test, member-delete test, onboarding-to-Assistant test, preview-availability test.
- **Complexity:** M
- **Acceptance:** ROAS renders correctly, Remove-member works, onboarding leads to a working preview via the Assistant, and Assistant messages persist.
- **Traces:** A12, D4, G4, G2, K7 (UX list).

### R6-04 — Honest plan disclosure, own legal entity and branding
- **Problem:** advertised features are unbacked (`clientWorkspaces` sold on Agency/Enterprise but read only by a billing bullet at `billing/page.tsx:95`; SSO/regional/SLA sold but unimplemented); ~40 brand strings and the enterprise/legal/support surfaces name the upstream third party (`yannick@adport.dev`) as data controller.
- **Why it matters:** selling absent capabilities and naming a third party as data controller are contracting/legal and trust blockers (K7 raises the legal-entity half to P1).
- **Depends on:** none (can proceed independently; grouped here as pre-launch honesty).
- **Files/subsystems:** `plans.ts`, `billing/page.tsx`, `billing.ts:58`, brand strings, legal/support surfaces.
- **Architecture impact:** remove or implement each advertised feature; re-brand to the operating entity.
- **Security impact:** none.
- **Data migration:** none.
- **Test requirements:** plan-disclosure test (no advertised flag without an implementation or enforcement).
- **Complexity:** M
- **Acceptance:** no plan advertises an unimplemented capability; all legal/branding/support surfaces name the operating entity.
- **Traces:** I4, I5, G6, G7, K7-03/K7-05/K7-19, I1-03/I2-01.

---

## Phase 7 — Scale, agency, and enterprise

**Entry:** Phases 0–6 delivered and the product is live for single-org tenants. **Theme:** K3's scale backbone and K7's agency/enterprise enablement — the differentiator-later items that require everything above to be real first.

### R7-01 — Multi-replica engine (externalized state, per-tenant serialization)
- **Problem:** the engine is a single-replica SPOF (per-process state, one global lock, single-file index).
- **Why it matters:** no horizontal scale or HA until state is externalized.
- **Depends on:** R0-08 (decision), R1-05 (externalized index/kill switch), R1-08 (job model).
- **Files/subsystems:** engine runtime, state store, `docker-compose.yml`/deploy.
- **Architecture impact:** stateless engine replicas over shared, org-scoped state with per-thread serialization.
- **Security impact:** per-replica kill-switch propagation (R1-05).
- **Data migration:** externalized state is the system of record.
- **Test requirements:** multi-replica isolation + serialization conformance (the R0-08 contract).
- **Complexity:** XL
- **Acceptance:** two or more engine replicas serve tenants with correct isolation, serialization, and kill-switch propagation.
- **Traces:** K3 (SPOF), D11, R0-08.

### R7-02 — Multi-org, client workspaces, and org switcher
- **Problem:** the data model is flat single-tenant (one org per user via `handle_new_user`, no org-creation route, no switcher UI); `clientWorkspaces` is a dead flag; org switching exists only as an API parameter.
- **Why it matters:** the agency persona is structurally unserved.
- **Depends on:** R0-07 (isolation), R0-08 (identity), R6-04 (stop selling until implemented).
- **Files/subsystems:** org model, `requireDashboardTenant`, org-creation route, switcher UI, `organization_ad_accounts`.
- **Architecture impact:** real multi-org with client workspaces and workspace-scoped accounts/roles.
- **Security impact:** cross-workspace isolation.
- **Data migration:** workspace/org schema extension.
- **Test requirements:** multi-org isolation + switcher tests.
- **Complexity:** XL
- **Acceptance:** an agency can manage multiple client workspaces with isolation and a switcher; `clientWorkspaces` is implemented, not just billed.
- **Traces:** I2, G6, G4, K7 (agency), R6-04.

### R7-03 — Enterprise enablement (SSO, regional hosting, SLA, sellable tier)
- **Problem:** the Enterprise tier is unsellable (no Stripe price, manual DB write only); sold SSO/regional/SLA/dedicated-onboarding are unimplemented; only custom retention is real.
- **Why it matters:** the enterprise persona cannot be sold or served.
- **Depends on:** R6-04 (honest disclosure), R7-02 (multi-org), R1-02/R1-03 (KMS/TLS for enterprise claims).
- **Files/subsystems:** `plans.ts`, `billing.ts:38-45,58`, SSO, regional hosting, SLA, enterprise admin UI.
- **Architecture impact:** enterprise features implemented and a sellable enterprise price path.
- **Security impact:** SSO and regional data residency.
- **Data migration:** none beyond R7-02.
- **Test requirements:** enterprise provisioning + SSO tests.
- **Complexity:** XL
- **Acceptance:** Enterprise is self-serve sellable with implemented SSO/regional/SLA.
- **Traces:** I4, I5, G6, K7-05.

### R7-04 — Full usage-based / hybrid billing and agency enablement
- **Problem:** pricing captures none of the AI cost drivers; usage-based billing is impossible without metering (built in R2-03).
- **Why it matters:** sustainable pricing of the dominant variable cost.
- **Depends on:** R2-03 (ledger), R7-02 (multi-org).
- **Files/subsystems:** `plans.ts`, `billing.ts`, metering ledger, Stripe metered prices.
- **Architecture impact:** usage-based/hybrid billing on the R2-03 ledger.
- **Security impact:** none.
- **Data migration:** metered price mapping.
- **Test requirements:** usage-to-invoice reconciliation tests.
- **Complexity:** L
- **Acceptance:** AI/engine usage is billed per org on a hybrid model with reconciliation.
- **Traces:** I1, I3, I5, K8-B3, `_business-and-pricing-architecture.md`.

### R7-05 — Event / outbox backbone
- **Problem:** there is no event/outbox backbone; every long operation is synchronous (addressed tactically in R1-08, but a durable event bus is the structural answer).
- **Why it matters:** reliable cross-system consistency (apply, billing, outcome loop) at scale.
- **Depends on:** R1-08 (job model), R0-09 (data-domain decision).
- **Files/subsystems:** a new outbox/event bus, apply/billing/outcome producers and consumers.
- **Architecture impact:** an event/outbox backbone decoupling producers from consumers.
- **Security impact:** none.
- **Data migration:** outbox table.
- **Test requirements:** at-least-once + idempotent-consumer tests.
- **Complexity:** XL
- **Acceptance:** cross-system state changes flow through a durable outbox with idempotent consumers.
- **Traces:** D9, K3 (missing backbone).

### R7-06 — Alerts, bulk operations, and the full Arabic brain
- **Problem:** the remaining Workbench differentiators (alerting, bulk ops) and a fully mature Arabic reasoning layer are not built.
- **Why it matters:** the mature-product differentiators, safe to defer until the core and scale are real.
- **Depends on:** R6-01 (Workbench), R3-05 (Arabic base), R5 (memory/outcome).
- **Files/subsystems:** alerting, bulk-op surfaces, Arabic doctrine/skills.
- **Architecture impact:** alerting and bulk-op pipelines over the governed write path.
- **Security impact:** bulk ops inherit all Phase-0 write gates.
- **Data migration:** none.
- **Test requirements:** alert-trigger tests; bulk-op gate tests.
- **Complexity:** L
- **Acceptance:** alerts and bulk operations run through the human-gated, metered write path; Arabic reasoning is fully mature.
- **Traces:** K7 (differentiator-later), R3-05.

---

## Open decisions for the owner

These are genuine product/architecture choices the roadmap sequences but does not decide. Each blocks or reshapes a phase.

1. **Engine multi-tenancy model (R0-08).** Per-tenant identity + per-thread serialization + externalized state, or a per-tenant engine process? This choice reshapes R0-07, R3-01/02, R5, and R7-01.
2. **System of record across the two Postgres instances (R0-09).** Which domain lives where, and whether to consolidate — this constrains every later migration.
3. **AI gateway build vs buy (R2-01).** K2 ratified "Option A safety items unconditionally, self-hosted Option B at multi-tenant live" — the owner decides when Option B is mandatory and whether to self-host.
4. **When to lift the fixture-only gate (R0-12 → R3-02).** The explicit go/no-go that converts latent P0s into live exposure; requires sign-off that R0-01..R0-11 are met plus a live-mode canary.
5. **Generic API tools: retire or scope (R0-03).** Retire the generic `*_api_update/remove` entirely, or keep them behind the mirrored risk classifier? Affects integration breadth vs blast radius.
6. **Pricing model (R2-03/R7-04).** Flat, usage-based, or hybrid for AI/engine cost — decides the metering granularity built in R2-03.
7. **Attribution/business-truth stance (R3-03/R3-04).** How much store/profit truth to require before surfacing "profitable/incremental" — sets the gating bar for the entire intelligence value proposition.
8. **Self-approval exception policy (R0-02).** Keep `MARKTING_ALLOW_SELF_APPROVAL` for single-user tenants, or forbid it entirely in multi-tenant live?
9. **Target markets / currencies and regional hosting (R3-05/R7-03).** Which Gulf currencies and data-residency regions are in scope — drives the currency-exponent set (R0-04) and enterprise hosting (R7-03).
10. **Upstream rebrand scope and legal entity (R6-04).** The operating entity, data-controller identity, and how far to re-brand the vendored surfaces before first contract.
11. **NOT_VERIFIED production facts.** The audit could not build or run the production envelope: Docker builds, the live stack, live Stripe/OAuth/model, real Supabase, DB concurrency under load, the MDA path, the restore drill, and Next.js RCE route reachability (SEC-04 P1↔P0). A networked CI runner and a staging environment must close these before launch; they gate Phase-1 exit.
