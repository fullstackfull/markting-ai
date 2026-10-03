# 02 — AI Architecture Assessment (markting-ai)

Author: C14, Chief AI Architect, consolidating the C1–C13 specialist audits and 15 independently
re-verified citations (see `docs/audit/agents/C14.md` for the spot-check log). Repository code is
the source of truth; documents are treated as claims. Every significant statement carries a
`path:line` citation and a classification tag: VERIFIED_CODE, VERIFIED_TEST, VERIFIED_RUNTIME,
DOCUMENTED_ONLY, INFERRED, NOT_VERIFIED. Paths are relative to `/home/user/markting-ai`.

---

## 0. Executive summary — what the AI actually is today

markting-ai vendors two Apache-2.0 projects — `paid-media-agent` (engine, a LangGraph "Deep Agent")
and `adport` (platform, the tool/policy/MCP layer) — and glues them with a markting host
(`services/engine-demo/serve_demo.py`) and a Next.js cloud app (`platform/apps/cloud`). The agent
machinery is real and, in places, unusually well engineered for safety. But as shipped and
configured, the "AI media buyer" is **a sandboxed demo chatbot wired to a synthetic dataset**, not
an operating system that reasons over a tenant's real accounts:

- The engine host **refuses to boot with any live credential and pins `PAID_MEDIA_DATA_MODE=sample`
  in both demo and live mode** (`serve_demo.py:139-171,383-392`, VERIFIED_CODE+RUNTIME, check 1).
  `MARKTING_ENGINE_MODE=live` swaps the scripted model for a real LLM but the data stays the three
  US-dollar fixture accounts (`runtime/catalog.py:51-58`). Everything the model "analyses" for a
  paying tenant is fixture data.
- The model receives **three text blocks and the user's text** per turn — `instructions.md`, the
  Deep Agents skills listing, a UTC date line — and **no tenant identity, business goal, margin,
  market, currency, budget plan, locale or history** (`engine-client.ts:114-116`,
  `surfaces/api/app.py:16-17`, VERIFIED_RUNTIME, check 11).
- There is **no durable memory, no learning, and no outcome loop**: no LangGraph `store`, no
  per-org context, and every bridged proposal is recorded in the engine as *rejected*
  (`bridge.ts:94`, `writes.py:498-511`, VERIFIED_CODE).
- The engine is genuinely **proposal-only and fail-closed** (`ProposalOnlyWriteProvider`, empty
  approver set, kill switch, boot assertions — VERIFIED_TEST). Real writes can only happen through
  **adport's own tool surface**, and that surface's two-step gate is **not a human approval**: an
  AI/script holding `tools:write` can validate then apply in two calls with no second human
  (`core/src/tools/write.ts:40-156`, `app/api/v1/tools/[tool]/route.ts:5-16`, VERIFIED_CODE,
  checks 5–6). The generic `*_api_*` tools additionally expose arbitrary API-shaped mutations with
  budget-only policy (`google/provider.ts:343-351`, `google/tools.ts:155-193`, VERIFIED_CODE,
  check 10).

So the central product invariant — *AI proposes → policy preview → human approval → apply* — holds
on the **engine → bridge** path (the Assistant) but **does not hold on adport's REST/MCP write
surfaces**, and the thing it is guarding (the model's reasoning) is not connected to real data
anyway. The explicit verdict the evolution plan builds on: **dashboard-with-chat today, not an
intelligent operating system** (see §9 and `03-ai-evolution-plan.md` §0).

---

## 1. The agent graph

Construction path (VERIFIED_RUNTIME, C1 §Graph): `Settings → configured_profile → load_catalog →
build_agent_components (assembly.py:179-290) → compile_graph → create_deep_agent`. The markting host
re-implements the self-hosted builder in `serve_demo.build_runtime` (`:201-240`) and swaps in
`ProposalOnlyWriteProvider`.

Compiled LangGraph nodes (fixture catalog, VERIFIED_RUNTIME C1, C9 check):
`__start__ → SkillsMiddleware.before_agent → PatchToolCallsMiddleware.before_agent →
ModelCallLimit.before_model → model → ModelCallLimit.after_model → HumanInTheLoop.after_model →
tools → __end__`. The `model` and `tools` nodes are wrapped (outer→inner) by the engine middleware:
`ModelRetry(2, on_failure="continue") · ModelTimeout(120s, async only) · ModelCallLimit(40) ·
CurrentDate · ToolSelection · InvocationGuard · ResultOffload(6000) · Redaction`
(`assembly.py:234-258`, VERIFIED_CODE, check 2). Deep Agents adds Skills, Filesystem, a hidden
general-purpose SubAgent, an unconditional Summarization middleware, PatchToolCalls, Anthropic
prompt caching, and HumanInTheLoop (`deepagents/graph.py:590-657,886-889`, VERIFIED_RUNTIME,
check 3).

| Property | Value | Evidence | Tag |
|---|---|---|---|
| Interrupt points | only `execute_change` (`approve`/`reject`, no `edit`) | `assembly.py:256-258`; `write_tools.py:82-114` | VERIFIED_CODE (check 2) |
| Recursion limit | 9,999 local/self-hosted; 200 under MDA | `deepagents/graph.py:700`; `managed_deepagents/runtime.py:182` | VERIFIED_RUNTIME |
| Per-run model-call cap | 40 (`exit_behavior="end"`; retries uncounted) | `config.py:120`; `model_call_limit.py:168,236` | VERIFIED_CODE |
| Per-call model timeout | 120s async; **sync path is a no-op** | `middleware/timeout.py:24-38` | VERIFIED_CODE |
| Per-run / per-request wall-clock deadline | **none** | `surfaces/runner.py:150-213`; `surfaces/api/app.py:91-101` | VERIFIED_CODE (absence) |
| Per-thread concurrency control | **none** (claim = ownership, not a mutex) | `runner.py:86-89`; `persistence/memory.py:94-96` | VERIFIED_CODE |
| Checkpointer | Postgres (`AsyncPostgresSaver`, pool max 4) when `DATABASE_URL`, else `InMemorySaver` | `runtime/self_hosted.py:45-105`; compose `:43` | VERIFIED_CODE |

Reliability consequence (C11): a model outage is returned to the user as an HTTP-200 English
sentence `"Model call failed after N attempts with ..."` (`model_retry.py:193-195` + `on_failure=
"continue"`, VERIFIED_RUNTIME, check 13); deterministic/config errors are retried as if transient
(`_retry.py:70-74`); a client abort at 240s (`engine-client.ts:73`) does not cancel the engine run,
which keeps spending (INFERRED continuation, VERIFIED_CODE timeouts).

---

## 2. Tools

Model-facing surface in the fixture profile (VERIFIED_RUNTIME, C3/C9): 6 Deep Agents filesystem
tools (`ls, read_file, write_file, edit_file, glob, grep`), 5 core (`list_accounts, discover_tools,
compare_periods, summarize_window, render_report`), 4 write (`discover_write_operations,
propose_change, execute_change, get_proposal`), and 12 fixture platform reads — 27 tools /
~21,217 chars. `execute`/`delete`/`task` are registered by deepagents but hidden and denied
(`middleware/authorization.py:22,58-93`, VERIFIED_CODE; VERIFIED_TEST `test_read_path_graph.py`).

Engine tool governance is **strong**: deny-by-default catalog with explicit reasons, host-side read
dispatch (alias→provider-id injection, raw-id rejection, jsonschema validation, offload), and the
governed write chain `propose → interrupt → signed single-use claim → WriteGate → one attempt →
reconciling readback` (`tools/catalog.py:130-215`, `tools/reads.py:140-199`,
`tools/writes.py:170-227,585-918`, VERIFIED_CODE; VERIFIED_TEST once the kill switch is isolated).

Weaknesses the specialists verified:

- **Read classification trusts `readOnlyHint`** from the external Pipeboard MCP server; a tool named
  `update_*`/`upload_*` with `readOnlyHint:true` becomes a direct model call (`catalog.py:170-190`,
  `pipeboard.py:48-69`, VERIFIED_CODE, C7-06). Name-deny covers only `mutate|raw|delete|remove|purge`.
- **Account scoping checks one argument name**; other id-bearing args (Meta `ad_account_id`, Google
  `login_customer_id`, list args) pass through under the shared token (engine `catalog.py:150`,
  `reads.py:170-181`, C7-05; cloud `account-scope.ts:48-54` checks top-level `account_id`/
  `customer_id` only, so Reddit/TikTok single-resource reads can cross accounts, C7-04). VERIFIED_CODE.
- **Model filesystem write covers `/workspace/**`** incl. the artifact store, report output, and the
  kill-switch path; integrity is a plain SHA-256 next to the payload, not an HMAC
  (`runtime/local.py:47-49`, `tools/artifacts.py:134-145`, C7-07). VERIFIED_CODE.
- **Three write vocabularies with inconsistent units** reach AI clients (engine currency/day; adport
  typed micros/cents/float; generic raw bodies), with the unit only in the description, not the
  schema (C7-09). VERIFIED_CODE.

---

## 3. Context

Exact per-turn context (VERIFIED_RUNTIME, C3 §2 cmd10, C9 `measure.py`): one `SystemMessage` of
~7,349–7,576 chars = `instructions.md` (4,055 B) + Deep Agents skills listing (~2.3–3.3k) + one
`Current date (UTC): …` line. Plus the bound tools (~21k chars) and the user's `{text}`. **Nothing
else.** The organization id and user id are encoded in the thread-id prefix
(`org_<uuid>__u_<uuid>__…`, `repository.ts:12-14`) but are never read by the engine or surfaced to
the model (VERIFIED_CODE, checks 11+1).

Context the model does **not** get, that a media buyer needs (C3 §4, VERIFIED_CODE): business
objective, margin / allowable CAC, country/market, reporting currency (fixtures are USD), break-even
ROAS, target CPA, budget plan, inventory, promotions/seasonality (Ramadan/Eid/White Friday), change
history, creative history, attribution settings, and **language/locale** — the prompt layer contains
no Arabic and no language directive anywhere (`grep` C3 cmd, C8 cmd1-2, C9 cmd12). The only
tenant-context mechanism the engine supports, `workspace/skills/company-context/`, is **absent,
Git-ignored (`engine/.gitignore:30`), deployment-global, and never created per org** — documented as
a shipped capability it does not have (`capability-map.md:18` vs reality, C3-03/C5-03). VERIFIED_CODE.

Context-efficiency defects (C9): `summarize_window` is unbounded (measured 14,401 chars for 3
fixture accounts) and crosses the 6,000-char offload cliff, after which the stub carries no path and
no deterministic tool can consume a `tool_result` artifact, so the numbers are lost
(`tools/summary.py:84-148`, `middleware/offload.py:44-52`, C9-01/C5-04, VERIFIED_RUNTIME). The model
can read the **entire engine checkout** (`src`, `tests`, `docs`, `instructions.md`) because the
permission policy denies only secrets and allows everything else (`runtime/local.py:28-50`,
VERIFIED_RUNTIME, check 4). Compaction fires only at ~850k tokens for the default model
(`summarization.py:274-286`, C9-09/C10-04).

---

## 4. Memory

| Layer | State today | Evidence | Tag |
|---|---|---|---|
| Conversation (within thread) | LangGraph checkpoints (Postgres or in-memory); **no read-back endpoint**, UI loses the thread on reload | `self_hosted.py:45-62`; `assistant-chat.tsx:24-25,45`; `surfaces/api/app.py` (no GET messages) | VERIFIED_CODE (C4-06) |
| Tenant isolation of conversations | one platform `startsWith` check; engine sees a single `caller_ref=adport-bridge` | `assistant.ts:34-38`; `docker-compose.yml:49`; `runner.py:86-89` | VERIFIED_CODE (C4-03) |
| Report "memory" | **one global `workspace/out/markting-reports.json` index + files served to any bearer, no org key** | `serve_demo.py:62,246-264,355-374` | VERIFIED_CODE (C4-01, check 12) |
| Model filesystem / artifacts | **one shared `/workspace` + `ArtifactStore` for every thread/org**; any thread can `ls`/`read_file`/`write_file` | `runtime/profiles.py:168-174`; `tools/artifacts.py:63-67`; `middleware/offload.py:33-41` | VERIFIED_CODE (C4-04, C5-02) |
| Evicted chat history | deepagents summarization writes verbatim prompts to `/conversation_history/{session}.md` on the shared backend, bypassing tool permissions, readable by other threads | `deepagents/graph.py:886-889`; `summarization.py:607-611`; `runtime/local.py:28-50` | VERIFIED_RUNTIME mechanics (C5-01, checks 3+4) |
| Decision outcome memory | every bridged proposal recorded as **rejected** on the engine side; true outcome (applied/rejected/expired) lives only in adport and is never fed back | `bridge.ts:94`; `writes.py:498-511`; `repository.ts:107-112` | VERIFIED_CODE (C4-05) |
| Deletion / retention | org deletion cascades `markting_*` but **never reaches engine checkpoints/`pma_*`/artifacts**; `apply_data_retention` omits `markting_*` and all engine tables; `pma_dedupe` has no TTL | `app/api/deletion/route.ts:21`; `20260828120000…sql:131-160`; `postgres.py:11-42`; `rg "delete_thread|prune|retention" engine/src` → none | VERIFIED_CODE (C4-02) |
| Tenant / account / long-term / outcome learning | **MISSING** — no `store`, no `memory.py`, `measurement_plan` stored but never acted on | `runtime/local.py:70-82`; `customization.md:112-125`; `domain/proposals.py:105-106` | VERIFIED_CODE (C4-11) |

The two cross-tenant isolation holes (shared report index, shared workspace+history) are latent
today only because the data is fixture-only and the same for every org; they become P0 the moment
live reads are enabled. VERIFIED_CODE + INFERRED (C4/C5).

---

## 5. The safety invariant — every bypass attempt and its verdict

Invariant under test: **AI proposes → policy preview → human approval → apply.** The write-path
enumeration below is the consolidated C13/C7 result, with the engine side re-confirmed by checks 1–2
and the adport side by checks 5–10.

| # | Bypass attempt | Verdict | Why | Evidence |
|---|---|---|---|---|
| 1 | Model calls a provider mutation directly in the engine | **BLOCKED** | `ProposalOnlyWriteProvider.call_mutation` raises; the host forces it; boot refuses live flags | `serve_demo.py:69-81,139-171,204-206` (VERIFIED_TEST) |
| 2 | Model self-approves its own `execute_change` interrupt | **BLOCKED** | `may_approve` requires an approver in `PAID_MEDIA_APPROVER_IDS`; the host asserts that set is empty | `writes.py:129-141`; `serve_demo.py:159-161` (VERIFIED_CODE) |
| 3 | Incident: engine keeps writing after a problem | **BLOCKED** | kill switch checked before every mutation incl. fakes; fail-closed, global | `writes.py:195-220` (VERIFIED_RUNTIME via the stray file, checks 1+3 of every cohort report) |
| 4 | Engine is tricked to execute a stale/replayed/tampered claim | **BLOCKED** | signed single-use HMAC claim, digest+TTL, `mark_used` before mutation, idempotency key | `writes.py:513-551,775-915` (VERIFIED_CODE; VERIFIED_TEST when kill switch isolated) |
| 5 | adport bridge approves the engine proposal | **BLOCKED (by design)** | the bridge only ever calls `validate`; it has no approve/edit path and rejects the engine interrupt | `bridge.ts:58-121`; `engine-client.ts:61,77-79` (VERIFIED_TEST) |
| 6 | Prompt injection via campaign name / MCP tool description changes the tool call, account, or value | **BLOCKED structurally** | tool surface/class decided by code; alias map + fixed allowlist + schema; prose never parsed | `translate.ts:129-160`; `authorization.py:58-93`; `markting-translate.test.ts` 29 passed (VERIFIED_TEST). Residual: injected text can bias the model's *choice among admitted ops* and populate the `reason` a reviewer reads (C8-07) |
| 7 | **AI/script with `tools:write` validates then applies via adport REST `/api/v1/tools/{tool}`** | **NOT BLOCKED — P1** | same `guardedWriteTool` handler applies when `pending_operation_id` present; route enforces scope only, forwards the raw body; no second human | `core/src/tools/write.ts:40-156`; `app/api/v1/tools/[tool]/route.ts:5-16`; `engine.ts:87-125` (VERIFIED_CODE, checks 5+6) |
| 8 | **Same, via the MCP `/mcp` connector** | **NOT BLOCKED — P1** | write tool registered for `tools:write` principals; the `approval:{arguments}` object is an advisory `structuredContent` hint, not an enforced interrupt | `app/mcp/route.ts:40-63`; `packages/mcp/src/index.ts:121-184` (VERIFIED_CODE) |
| 9 | **Generic `*_api_update/create/remove` makes an uncapped status/bid/targeting/destructive change** | **NOT BLOCKED — P1** | policy rejects only budget-key regexes; status flip (starts delivery), bid change, targeting, delete all pass with no risk flag | `google/provider.ts:343-351`; `google/tools.ts:155-193`; `tiktok/provider.ts:288-291`; `meta/provider.ts:376-379` (VERIFIED_CODE, check 10) |
| 10 | Requester approves their own change from the dashboard | **PARTIALLY NOT BLOCKED — P2** | guard short-circuits when `created_by` is null, which it is for API-key principals | `approvals/[id]/apply/route.ts:22-24`; `repository.ts:377-381` (VERIFIED_CODE, check 8) |
| 11 | Concurrent/duplicate apply executes a live mutation twice | **NOT BLOCKED — P2** | `get → applyWrite → delete` with no lock/transaction and no idempotency key into `applyWrite`; only the sandbox provider has a CAS | `engine.ts:87-125`; `repository.ts:413-418`; `provider.ts:79` (VERIFIED_CODE, check 7) |
| 12 | A tightened budget cap is evaded by applying an already-validated op | **NOT BLOCKED — P3** | apply re-runs `checkStaticPolicy` only, not `checkBudgetPolicy` | `engine.ts:110-153` (VERIFIED_CODE, check 9) |

Conclusion: the **engine** is a genuinely fail-closed proposal engine (attempts 1–6 blocked, VERIFIED).
The **product-level invariant is broken on adport's autonomous write surfaces** (attempts 7–9, P1),
with correctness/SoD gaps on the human path too (10–12). The README's "nothing is applied until a
human approves it" (`README.md:79`) is true only for the Assistant, not for REST/MCP
(VERIFIED_CODE). These surfaces are plan-gated and off the Assistant path, but they are shipped and
exposed to any holder of a `tools:write` key.

---

## 6. Reliability

| Capability | Classification | Evidence |
|---|---|---|
| Hard per-call async model timeout | EXISTS_AND_STRONG | `middleware/timeout.py:30-38` (VERIFIED_TEST) |
| Anti-loop per-run call cap (40) | EXISTS_AND_STRONG | `assembly.py:242-244` |
| Write-execution no-retry + idempotency + reconciling readback | EXISTS_AND_STRONG (code), unreachable in product | `writes.py:775-915` (VERIFIED_CODE; red here due to kill switch) |
| Model failure surfaced as an error to the caller | MISSING — returned as HTTP-200 text | `model_retry.py:193-195`; `surfaces/api/app.py:91-101` (C11-01, check 13) |
| Retry limited to transient classes | MISSING — retries every non-`ModelError` | `_retry.py:70-74` (C11-02) |
| Per-turn / per-request wall-clock deadline | MISSING | `app.py:91-101` (C11-03) |
| Client-disconnect cancellation of the engine run | MISSING | `engine-client.ts:81-99`; `app.py:91-101` (C11-04, INFERRED continuation) |
| Per-thread serialization / idempotency on chat | MISSING | `runner.py:86-89` (C11-05) |
| Catalog/provider-outage resilience | EXISTS_BUT_LIMITED — load-once, errors→`[]`, `/health` unaware | `pipeboard.py:95-134`; `app.py:80-89` (C11-06) |

---

## 7. Observability

Essentially a floor of zero on the self-hosted path (C12, VERIFIED_CODE):
no correlation/trace id across cloud→engine (`engine-client.ts:84-99`, `runner.py:86-89`);
LangSmith/OTel tracing **never enabled** — the only `tracing_context` call *disables* it
(`demo_script.py:207-210`; `grep LANGSMITH_TRACING|OTEL` → none); **no token or cost capture**
anywhere (`grep usage_metadata engine/src` → empty, check 15); the engine has 5 log sites total and
no per-turn structured log (`cli.py:23-26`, `authorization.py:82,89`, `pipeboard.py:119`); the read
audit is an in-memory 500-entry ring consumed only by the demo (`reads.py:137,210-219`); cloud chat
turns write no usage row (`assistant.ts:30-79` records only on `awaiting_approval`); the `expired`
proposal outcome is declared but never written and no sweep job runs (`markPendingOutcome`,
`repository.ts:420-425`). Write-outcome provenance that *does* exist is rich and RLS-scoped
(`markting_engine_proposals`, `audit_events`). DOCUMENTED_ONLY claims that the self-hosted stack can
be inspected in LangSmith (`engine/README.md:141`) apply only to the managed MDA path.

---

## 8. Cost

No metering, no caching, no quota (C10, VERIFIED_CODE on mechanics; dollar figures INFERRED from an
assumed price table + chars/4 heuristic, explicitly flagged by C10 and not treated as fact here):

- **No prompt caching** — the ~5.6k-token stable prefix and the whole transcript are re-billed every
  call (`resolve_model` passes no `cache_control`, check 14; `assembly.py:160-172`). Caching is the
  single biggest lever and the prefix is already cache-friendly.
- **Unbounded context growth** — compaction at ~850k tokens with the *main* model as summarizer; the
  UI reuses one thread per session (`summarization.py:274-286`, `assistant-chat.tsx:25,45`).
- **No per-org token/cost ledger and no spend quota** — the only limiter is 120 req/min/user
  (`repository.ts:355`), a throughput limit, not a cost limit; plans carry no usage dimension
  (`plans.ts:11-21`). INFERRED exposure: one seat can drive hundreds of dollars/min in live mode.
- **Retry amplification** uncounted by the 40-call cap (up to ~9 HTTP attempts per logical call,
  `assembly.py:166,240`); `max_tokens` left at the 128k profile default.
- Deterministic report path (`/reports/run`, CLI `report`) costs **$0** in model tokens (VERIFIED).

The default shipped mode is `demo` (scripted model) → **$0** until `MARKTING_ENGINE_MODE=live`.

---

## 9. Capability roll-up and the verdict

| Capability | Classification | Evidence (anchor) |
|---|---|---|
| Fail-closed proposal-only engine | EXISTS_AND_STRONG | §5 attempts 1–5 |
| Engine governed write chain (propose→claim→gate→readback) | EXISTS_AND_STRONG (unused in product) | `writes.py:585-918` |
| Engine tool governance (deny-by-default, host read dispatch) | EXISTS_AND_STRONG | `catalog.py`, `reads.py`, `authorization.py` |
| Model-output→adport boundary (allowlist/alias/schema) | EXISTS_AND_STRONG | `translate.ts:129-160` |
| Live analysis of a tenant's real accounts | MOCK_ONLY | §0, `serve_demo.py:383-392` |
| Per-tenant / business / locale context to the model | MISSING | §3 |
| Durable/tenant/account/outcome memory & learning | MISSING | §4 |
| Universal human-approval on writes | EXISTS_BUT_LIMITED (dashboard only) | §5 attempts 7–10 |
| Generic `*_api_*` autonomous writes | UNSAFE_TO_AUTOMATE | §5 attempt 9 |
| Metering / quotas / cost controls | MISSING | §8 |
| Observability (trace/token/latency per request) | MISSING | §7 |
| Reliability (typed failures, run deadline, concurrency) | EXISTS_BUT_LIMITED | §6 |
| Evaluation of reasoning quality | EXISTS_BUT_LIMITED (3/15 auto-graded, not in CI) | C6-05/06 |
| Arabic-first reasoning / reports | MISSING (UI only) | C3-05, C8-03 |

**Verdict: dashboard-with-chat, not an intelligent operating system — proven from capabilities.**
An intelligent operating system would (a) reason over the tenant's real connected accounts, (b)
carry the tenant's goals, economics, market and history as first-class context, (c) remember prior
decisions and measure their outcomes, and (d) act through a single governed, human-gated, metered,
observable write path. markting-ai has none of (a)–(c) in the shipped path and a *split* (d): the
engine's governed path is safe but disconnected and proposal-only, while the connected write path
(adport REST/MCP) is not human-gated. What exists is a safety-engineered skeleton and a
synthetic-data demo chatbot. The bones are good — the fail-closed engine, the deny-by-default
catalog, the output boundary, the deterministic compute/report tools are all real and well tested —
which is exactly why the forward plan (`03-ai-evolution-plan.md`) is an *evolution*, not a rewrite.

---

## 10. Consolidated findings (de-duplicated, final severity)

Full detail and recommendations are in the specialists' reports; IDs below are the consolidation,
with the subsumed specialist findings named.

- **C14-P1-01 — adport REST/MCP write surfaces apply with no enforced human approver** (subsumes
  C7-01, C13-01). Invariant bypass for any `tools:write` holder. `core/src/tools/write.ts:40-156`,
  `app/api/v1/tools/[tool]/route.ts:5-16`, `mcp/index.ts:121-184`. VERIFIED_CODE.
- **C14-P1-02 — generic `*_api_*` tools allow arbitrary mutations with budget-only policy**
  (subsumes C7-02, C7-03). Status/bid/targeting/destructive changes uncapped. `google/tools.ts:155-193`,
  `google/provider.ts:343-351`. VERIFIED_CODE. Capability UNSAFE_TO_AUTOMATE.
- **C14-P1-03 — the engine receives zero tenant/business/locale context and only ever analyses
  fixture accounts** (subsumes C3-01, C3-02, C3-03/C5-03). Core product promise unbacked.
  `engine-client.ts:114-116`, `serve_demo.py:383-392`. VERIFIED_CODE+RUNTIME.
- **C14-P1-04 — cross-tenant isolation holes in the model's shared state** (subsumes C5-01, C5-02,
  C4-01, C4-04, C8-08, C9-05). Shared report index/files, shared `/workspace`+`ArtifactStore`, and
  summarization history written world-readable to `/conversation_history`. Latent today
  (fixture-only), P0 on live reads. VERIFIED_RUNTIME mechanics.
- **C14-P1-05 — org deletion and retention never reach engine memory** (subsumes C4-02). Checkpoints
  (verbatim user prose), `pma_*`, artifacts retained indefinitely; `data_retention_days` not honoured
  for conversations. `app/api/deletion/route.ts:21`, `20260828120000…sql:131-160`. VERIFIED_CODE.
- **C14-P2-01 — no token/cost metering and no spend quota** (C10-01, C10-02, C2-02, C12-03).
- **C14-P2-02 — no prompt caching; unbounded context growth** (C10-03, C10-04, C9-09). check 14.
- **C14-P2-03 — model failures masked as HTTP-200 answers; all errors retried; no run deadline;
  client abort orphans the run** (C11-01, C11-02, C11-03, C11-04, C1-04, C2-03, C10-05). check 13.
- **C14-P2-04 — no per-thread concurrency control / idempotency on chat; non-atomic live apply**
  (C11-05, C1-03, C13-02). check 7.
- **C14-P2-05 — demo engine mis-routes analysis questions to a hard-coded budget-cut proposal and
  shares scripted state across threads/tenants** (C3-04, C6-01, C6-02, C8-01, C8-02, C1-07).
  Demo code reaching the production approval path. VERIFIED_RUNTIME.
- **C14-P2-06 — account scoping checks one argument; cross-account reads possible; engine trusts
  `readOnlyHint`** (C7-04, C7-05, C7-06). VERIFIED_CODE.
- **C14-P2-07 — self-approval guard bypassed for API-key-created pending ops** (C13-03). check 8.
- **C14-P2-08 — secret redaction misses JSON-quoted keys and common token shapes** (C8-04). VERIFIED_RUNTIME.
- **C14-P2-09 — no end-to-end tracing, correlation id, per-turn logging, or durable read audit**
  (C12-01, C12-02, C12-04, C12-05).
- **C14-P2-10 — oversized deterministic results offload to an unusable stub (no path, no consumer);
  model can read the whole checkout** (C9-01, C5-04, C9-05). check 4.
- **C14-P2-11 — engine-side outcome memory is systematically wrong (every bridged proposal recorded
  as rejected)** (C4-05, C8-05). VERIFIED_CODE.
- **C14-P3-01 — model filesystem write covers artifacts/reports/kill-switch; SHA-256 not HMAC**
  (C7-07). VERIFIED_CODE.
- **C14-P3-02 — budget cap re-check skipped at apply; `expired` outcome never written** (C13-04,
  C12-07). checks 9.
- **C14-P3-03 — three inconsistent write vocabularies/units exposed to AI clients** (C7-09).
- **C14-P3-04 — provider extras advertised in presets/.env are not installed in the engine image;
  implicit `LANGSMITH_GATEWAY` reroute contradicts "no implicit gateway"** (C2-01, C2-07).
- **C14-P3-05 — engine test suite is not hermetic (stray `workspace/KILL_SWITCH` reddens 16–19
  write-flow tests); no model-behaviour regression in CI** (C1-06, C4-08, C6-03, C6-06, C10-09,
  C11-07/D1, C13-05). Test-isolation defect, not a product defect. VERIFIED_RUNTIME.
- **C14-P3-06 — eval harness: q02 expectation disagrees with fixtures; 12/15 questions have no
  machine check; no provenance/hallucination grader** (C6-04, C6-05, C6-08). checks 15 (PARTIAL).
- **C14-GAP-01 — no durable/tenant/account/long-term/outcome memory or learning** (C4-11, C5-06).
- **C14-GAP-02 — Arabic-first applies to UI chrome only; no language/locale policy, no Arabic corpus,
  no Arabic reports, no regional (Snap/TikTok, Gulf calendar) playbooks** (C3-05, C5-05, C8-03,
  C6-09, C9-12).
- **C14-GAP-03 — tool coverage gaps for a real media buyer: no creative/frequency reads, no change
  history, no Snap/TikTok/Pinterest/LinkedIn engine fixtures, no deterministic anomaly/decomposition
  tools** (C7-16, C6-10).

---

## 11. Confidence and what was NOT verified

Confidence: **0.85** for the consolidated code-level findings (14/15 citations CONFIRMED, 1 PARTIAL;
the specialists cross-corroborate each other on the invariant, the sample-mode pinning and the kill
switch). Lower where the authors themselves flag it.

NOT_VERIFIED (inherited from the cohort; would need resources an audit must not use): live-model
behaviour (`MARKTING_ENGINE_MODE=live`, no key) — Arabic answers, injection susceptibility, the
real live-turn shape and cost; the Docker image contents (builds blocked); Postgres/Supabase
concurrency behaviour (the double-apply race and JSONB-CAS are VERIFIED_CODE, not reproduced); the
MDA hosted path (Context Hub, platform checkpointer, `MANAGED_RECURSION_LIMIT`); live Pipeboard
catalog schemas (so C7-05/C7-06 are mechanism-level); whether any deployment cron invokes the
pending sweep; and the exact dollar figures in §8 (assumed price table + chars/4 heuristic).
