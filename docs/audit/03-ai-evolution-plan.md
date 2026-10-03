# 03 — AI Evolution Plan (markting-ai)

Author: C14, Chief AI Architect. This is a **design document, not an implementation**. It builds on
the evidence in `02-ai-architecture-assessment.md` and the C1–C13 specialist audits. Where a design
choice is anchored in current code, the `path:line` and tag are given; forward designs are labelled
DESIGN. The guiding constraint (VERIFIED_CODE, `UPSTREAM.md:66-68`): `engine/` is a vendored,
byte-identical Apache-2.0 import, so markting-owned logic belongs in `services/engine-demo/`, a new
sidecar, or `platform/` — the engine is extended through its seams (`build_agent_components(
system_prompt=…)`, `assembly.py:186,260-264`; `init_chat_model` base_url/key, `assembly.py:166-171`),
not forked.

---

## 0. Where we are, and the shape of the climb

**Verdict (from 02 §9, proven from capabilities): markting-ai is a dashboard-with-chat over
synthetic data, not an intelligent operating system.** It has an excellent safety skeleton (a
fail-closed proposal engine, a deny-by-default tool catalog, a strong model-output→adport boundary,
deterministic compute/report tools) and nothing connected to it: no real tenant data reaches the
model, no tenant/business/locale context, no memory, no learning, no outcome loop, and a *split*
write path where the governed side is proposal-only and the connected side (adport REST/MCP) is not
human-gated.

The evolution is therefore not a rewrite. It is four moves, in order:

1. **Make it safe to connect** (close the invariant and isolation holes — 02 findings P1-01/02/04/05,
   P2-07) before any live read/write is enabled for more than one trusted org.
2. **Give the model a brain to reason with** — the Marketing Intelligence Layer (§2) and Marketing
   Memory (§3) injected per turn, replacing fixtures with the tenant's real accounts.
3. **Turn chat into a governed decision pipeline** — the Recommendation Engine (§4) and the AI Media
   Buyer Workbench (§5), with one human-gated, metered, observable write path.
4. **Close the loop** — measure every executed recommendation and learn from the outcome (§6).

The AI Gateway (§1) is the prerequisite plumbing for 2–4 (routing, quotas, tracing, caching).

---

## 1. AI Gateway

Problem set (02 §§1,6,7,8): one process-global model resolved once (`assembly.py:189-195`), no
fallback/circuit-breaker (`with_fallbacks` absent), no caching (check 14), no per-org quota, no
tracing (the only `tracing_context` call disables it, `demo_script.py:207-210`), retries on every
error (`_retry.py:70-74`), failures masked as HTTP-200 (check 13). The gateway must own: routing,
fallback, quotas, model allowlists, tracing, retries, circuit breakers, caching.

### 1.1 Three options (consolidated from C2; trade-offs are the architect's, INFERRED)

**Option A — Harden the in-process LangChain routing (markting-owned, no new infra).** In
`serve_demo.py` live mode: boot-time key/import/smoke check; `MARKTING_ALLOWED_MODELS` allowlist;
`with_fallbacks([...])` chain; a `UsageMiddleware` (`wrap_model_call`) that reads
`usage_metadata` and writes `{org, user, thread, model, in, cached_in, out, latency}` to Postgres,
attributed from the `thread_id` prefix; ephemeral `cache_control` on system+tools and the last
message; a run-level `asyncio.wait_for` deadline; a per-thread lock + idempotency key; OTel/LangSmith
enabled with org/thread/request-id tags. Quotas enforced in the cloud route from the usage ledger.
*Fits:* one or two trusted orgs, Anthropic/OpenAI only, near-term. *Cons:* every control is bespoke
Python; per-org keys impossible without one engine process per org; circuit-breaking/caching DIY.

**Option B — Self-hosted central gateway (LiteLLM-proxy-class, OpenAI-compatible) as a compose
sidecar.** `PAID_MEDIA_MODEL=openai:<alias>`, `PAID_MEDIA_MODEL_BASE_URL=http://ai-gateway/v1`,
`PAID_MEDIA_MODEL_API_KEY_ENV=MARKTING_GATEWAY_KEY`; the gateway owns provider keys, model aliases,
allowlists, retries, fallback groups, circuit breakers, spend logs, per-virtual-key budgets,
response caching, and OTel/Langfuse tracing. The engine container holds **no** vendor key (and
C2-01 — missing provider extras in the image — disappears). *Caveat (VERIFIED_CODE):* setting
`base_url` forces the portable LLM tool selector (`tool_selection.py:166-167`), costing one extra
cheap call per turn and losing Anthropic/OpenAI native tool search; per-org budgets need the host to
stamp an org tag on each request (the engine sends one key for all). *Fits:* multi-tenant live mode,
multiple/regional providers, need for per-org budgets and auditability before billing.

**Option C — Managed gateway (LangSmith LLM Gateway, `langsmith:provider/model`).** Already wired
end-to-end (`config.py:43-44`, `tool_selection.py:72-80`, tests pass). Zero infra, broadest model
list, tracing included. *Cons:* third-party on the critical path; KSA data-residency/egress
question; portable-selector cost; the implicit `LANGSMITH_GATEWAY` reroute (C2-07) must be managed.
*Fits:* internal multi-model evaluation, not tenant traffic unless residency is cleared.

### 1.2 Recommendation (DESIGN)

Ship **Option A's safety items unconditionally** (boot readiness, allowlist, run deadline, usage
ledger keyed by org, caching, per-thread lock, tracing) — they are prerequisites for every option
and live entirely in markting-owned code. Adopt **Option B** when live mode goes multi-tenant: it is
the only option that keeps vendor keys out of both app containers and gives per-key budgets,
fallback and circuit-breaking without engine edits; measure and accept the portable-selector cost.
Keep **Option C** as the fast path for internal model evaluation only.

### 1.3 Gateway requirements checklist (DESIGN)

| Concern | Requirement | Current gap |
|---|---|---|
| Routing | per-plan default model; per-org allowlist; cheap selector/summarizer (Haiku-class) distinct from the main model | one global model (`config.py:113`); summarizer hard-wired to main (`deepagents/graph.py:803`) |
| Fallback | ordered provider fallback group per request | none (`with_fallbacks` absent) |
| Retries | transient classes only (429/5xx/timeout), jittered backoff; everything else fails fast | retries all (`_retry.py:70-74`); nested SDK×middleware ≈9 attempts |
| Circuit breaker | per-provider health state across runs, exported to `/markting/info` | none |
| Quotas | per-org monthly token/$ budget enforced in the cloud route (402 `PLAN_LIMIT` pattern exists, `plan-limit.ts:19`); per-thread lifetime call cap | only 120 req/min/user (`repository.ts:355`) |
| Allowlist | which models an org/plan may use | none |
| Tracing | one correlation id minted at the cloud edge, forwarded, bound into `RunnableConfig.metadata`, logs, and every audit/provenance row; redaction on the sink | no trace id, tracing disabled, redaction only on the model-facing path (C8-04/C12-08) |
| Caching | ephemeral breakpoints on the stable prefix + last message; target ≥70% cached input on turn ≥2 | none (check 14) |
| Failure surfacing | typed error (code+localized message) to the UI, never a `<pre>` of a Python exception | HTTP-200 sentinel (check 13) |

---

## 2. Marketing Intelligence Layer (the ontology the model reasons over)

Today the model gets `{text}` + fixtures (02 §3). The Intelligence Layer is a **tenant-scoped,
versioned, provenance-carrying knowledge graph** owned by adport (where tenancy, RLS, retention and
the provider reads already live), surfaced to the model as a compact per-turn context block plus
tenant-isolated retrieval tools — never a shared folder, never a model argument for `organization_id`
(bound server-side from the thread-id prefix, `repository.ts:12-14`).

### 2.1 Ontology (DESIGN)

Every entity is keyed by `organization_id`, carries `source ∈ {platform_api, user_stated, derived,
imported}`, `confidence`, `as_of`, `version`, and (for money) `currency`.

| Entity | Key fields | Source today | Gap |
|---|---|---|---|
| **Organization** | id, name, locale, country, reporting currency, reporting timezone, VAT treatment, fiscal calendar | `organizations(name, slug)` only (`cloud_initial_schema.sql:24-31`) | no locale/country/currency/tz |
| **Brand** | org_id, name, voice, protected-brand flag, guidelines ref | — | MISSING |
| **Store** | org_id, platform (Salla/Zid/Shopify), domain, catalog link | `docs/TODO.md:17-19` (planned) | MISSING |
| **AdAccount** | org_id, provider, provider_account_id, currency, timezone, scope, attribution settings | engine alias/platform/currency/tz (`config.py:60-69`); adport `organization_ad_accounts` | no attribution/scope to the model |
| **Campaign** | account_id, provider_ref, objective, funnel role, bid strategy + target, learning state, naming decoded | reads only (campaign grain) | no objective/funnel/bid-target/structure memory |
| **AdGroup / AdSet** | campaign_id, targeting, audience_ref, bid | reads (ad-group perf) | no targeting/audience |
| **Ad** | adgroup_id, creative_ref, status, launch date | — | MISSING (no ad-level read) |
| **Creative** | id, format, headline/body (Arabic+en), asset refs, launch date, fatigue metrics | — | MISSING (no creative tool, C7-16) |
| **Audience** | id, definition, size, exclusions, source | — | MISSING |
| **Product** | store_id, sku, title, price, **gross margin**, stock, category | — | MISSING (blocks break-even ROAS) |
| **Order / Conversion** | id, value, event type, source (pixel/CAPI/CRM/Salla), timestamp, attribution window | provider conversions only; Reddit has no value | no offline/CRM join, no event definition |
| **Spend / Revenue / Margin** | entity_ref, window, amount, currency | spend/value from reads; **no margin** (no product cost) | margin uncomputable today (C3-07) |
| **Recommendation** | id, entity_ref, diagnosis, proposed change, risk, expected effect, status | engine `ProposalRecord`; adport `markting_engine_proposals` | not linked to outcome |
| **Experiment** | id, hypothesis, holdout/geo design, window, result | — | MISSING |

### 2.2 Delivery contract (DESIGN)

Per turn the cloud builds a **bounded memory brief** (org identity + locale + currency + timezone;
account targets; top-N open recommendations with verdicts; do-not-touch list; stated goals or an
explicit "goals unknown") and sends it with the message — either a system-prefixed section or, better,
a new engine endpoint field `context` so it is never confused with user prose (requires extending
`MessageIn`, `surfaces/api/app.py:16-17`, host-side only). The long tail (history, creatives, promos,
product margins) is retrieved through **tenant-isolated deterministic tools** (`search_history`,
`list_past_changes`, `get_product_margins`) added to `core_tools` (`assembly.py:184-190`). Retrieval
is structured/SQL+FTS first (small per-tenant corpora); vectors (pgvector, not enabled today, C5 cmd18)
only for unstructured corpora (brand books, creatives, platform docs), hybrid FTS+ANN with Arabic
normalisation, filtered `organization_id IN (NULL, $org)`, with citations. The wiki stays
progressive-disclosure (3.6k words — do not index it).

---

## 3. Marketing Memory boundaries (DESIGN, adopted from C4 §"world-class")

Principles that fall out of the findings (02 §4): tenancy is decided before the model runs and the
engine must know it; memory lives in adport's Postgres, not the engine; the engine stays stateless
per tenant except for checkpoints; the model may *propose* a fact but a human confirms it; no learned
value ever changes a policy limit, approver set, or protected-account list.

| Layer | Store (DESIGN) | Key | Written by | Injected? |
|---|---|---|---|---|
| **Conversation** | LangGraph checkpoints | `thread_id = org__u__rand` + per-org workspace root | engine | read-back via a tenant-scoped `GET /threads/{id}/messages` |
| **Tenant memory** | `markting_memory_facts(org, scope∈{org,account,campaign}, key, value jsonb, source, confidence, created_by, expires_at, superseded_by, status∈{proposed,confirmed})` | org + scope_ref | platform (user) / model proposes | only `confirmed` (and reviewed `derived`) facts |
| **Account memory** | baselines (rolling 7/28-day snapshots), structure digests | (org, provider, account_id) | platform provider reads | as context + retrieval |
| **Decision memory** | extend `markting_engine_proposals` with outcome columns (see §6) | org + proposal_id + revision | platform | last-N into the brief |
| **Audit memory** | keep `audit_events` immutable; surface `details` (written but not read, C4-09) | org | platform | not injected (log) |

Lifecycle fixes required before any of this (02 P1-04/05): per-org workspace root + `ArtifactStore`
+ report index (kill the shared `/workspace`, `/conversation_history`, `/reports`); a deletion-route
call into an engine purge (`checkpointer.adelete_thread` + `pma_*` + artifacts by org prefix);
`apply_data_retention` extended to `markting_*` + memory facts (by `expires_at`) + engine tables;
TTL on `pma_dedupe`. Hand-off semantics fixed so engine memory stops recording every proposal as
rejected (02 P2-11): a `handed_off` decision instead of `reject`, and the adport outcome written back
into the thread as a system message.

---

## 4. The Recommendation Engine, stage by stage against current code

Target pipeline: **DATA → VALIDATION → NORMALIZATION → SIGNAL DETECTION → DIAGNOSIS → RECOMMENDATION
→ RISK ASSESSMENT → POLICY PREVIEW → HUMAN APPROVAL → EXECUTION → OUTCOME MEASUREMENT → LEARNING.**
Each stage is graded against what the code does today.

| Stage | Today | Classification | Evidence | Gap to close |
|---|---|---|---|---|
| **DATA** | fixture reads only; live reads refused at boot; per-turn context empty | MOCK_ONLY | `serve_demo.py:139-171,383-392`; `reads.py:140-199` (check 1) | route reads through adport's tenant runtime; inject the memory brief (§2.2) |
| **VALIDATION** | typed read schemas; raw-id rejection; missing≠zero; window/completeness honesty; refuses empty/uncovered windows | EXISTS_AND_STRONG | `reads.py:76-97,160-191`; `compare_periods.py:66-79`; `test_summarize_window.py:147-190` (VERIFIED_TEST) | extend to attribution/completeness per account from Account memory |
| **NORMALIZATION** | per-provider read normalizers; cross-platform total suppressed on mixed currency; entity names unbounded/undelimited (injection channel) | EXISTS_BUT_LIMITED | `tools/normalize.py:123-128`; `compute.py` suppression; C8-07 | cap/delimit provider strings; Snap/TikTok/Pinterest/LinkedIn normalizers (none today, C7-16) |
| **SIGNAL DETECTION** | deltas + spend-ranked `attention` lines + pacing + ±50% day flags; **no significance test, no ROAS decomposition, no marginal-efficiency curve, no creative/frequency signals** | PARTIAL | `compute.py:349-372`; `summary.py:28,98-141`; `anomaly-and-significance.md:21-28` (admits no test) | deterministic `explain_delta` (value vs spend vs mix), significance test, fatigue/saturation signatures (needs creative/frequency data) |
| **DIAGNOSIS** | model reasons over `attention` lines; no goal/margin/market/history to reason from; wiki doctrine is generic/English/US-centric | EXISTS_BUT_LIMITED (reasoning) / MISSING (grounding) | 02 §3; C3-01; C5-05 | Intelligence Layer (§2) + Arabic/regional doctrine |
| **RECOMMENDATION** | engine `propose_change` is typed, catalog+schema+policy validated, digest-persisted; demo mode hard-codes one budget cut regardless of question | EXISTS_AND_STRONG (engine) / MOCK_ONLY (demo) | `writes.py:326-371`; `demo_script.py:158-170`; C3-04/C6-02/C8-01 | intent-aware demo; recommendation must cite the targets/economics used |
| **RISK ASSESSMENT** | engine `classify_risk` (`starts_delivery`, budget_increase, destructive, bulk); **adport side has no equivalent — budget-key regex only** | EXISTS_AND_STRONG (engine) / EXISTS_BUT_LIMITED (adport) | `writes.py:77-126`; C7-02/C7-03 (check 10) | mirror engine risk classification on the adport write path; route high-risk to mandatory human apply |
| **POLICY PREVIEW** | two-step validate→preview with hash binding, budget caps, paused-creation, protected accounts | EXISTS_AND_STRONG | `engine.ts:31-153`; `markting-bridge.test.ts` (VERIFIED_TEST) | re-check budget caps at apply too (only static re-checked, check 9) |
| **HUMAN APPROVAL** | enforced on the dashboard apply route; **absent on REST/MCP; bypassed for API-key-created rows** | EXISTS_BUT_LIMITED | `approvals/[id]/apply/route.ts:18-24`; `write.ts:40-156`; `mcp/index.ts:121-184` (checks 5,6,8) | **the single most important fix** — enforce an out-of-band approver on every apply surface (02 P1-01) |
| **EXECUTION** | engine single-attempt + idempotency + reconciling readback (but proposal-only in product); **adport apply is non-atomic, no idempotency key** | EXISTS_AND_STRONG (engine, dormant) / PARTIAL (adport) | `writes.py:775-915`; `engine.ts:87-125`; `repository.ts:413-418` (check 7) | atomic consume (`... where consumed_at is null returning *`) + idempotency key into `applyWrite` |
| **OUTCOME MEASUREMENT** | `measurement_plan`/`reversal_plan` parsed and stored but **nothing schedules a measurement or records an outcome**; engine records every proposal as rejected; `expired` never written | MISSING | `domain/proposals.py:105-106`; `translate.ts:38-39`; C4-05/C12-07 | §6 |
| **LEARNING** | no LangGraph `store`, no outcome table, no accepted/rejected learning | MISSING | `runtime/local.py:70-82`; `customization.md:112-125` | §6 governed learning |

Reading of the pipeline: stages **VALIDATION, POLICY PREVIEW** and the engine halves of
**RECOMMENDATION/RISK/EXECUTION** are genuinely strong. **DATA, DIAGNOSIS grounding, HUMAN APPROVAL
(on autonomous surfaces), OUTCOME MEASUREMENT and LEARNING** are the load-bearing gaps — and
SIGNAL DETECTION is only half-built. An "AI media buyer" is exactly the sum of the missing stages.

---

## 5. The AI Media Buyer Workbench (modules, DESIGN)

A governed operating surface, not a chat box. Each module maps to a context profile (adopting C9's
intent-router + per-profile segmentation) so the model is bound only the tools it needs.

| Module | Purpose | Reuses | New |
|---|---|---|---|
| **Account Cockpit** | per-account real-time pacing, baselines, anomalies, open recommendations | `summarize_window`, `compare_periods`, Account memory | live reads, bounded summaries (fix C9-01) |
| **Diagnosis Studio** | "why did ROAS/CPA move?" with code-computed decomposition and citations | `explain_delta` (new), SIGNAL DETECTION | significance test, mix/value/spend split |
| **Recommendation Queue** | model proposals with diagnosis, risk flag, expected effect, economics used; one-click human approve | `propose_change`, adport preview, Decision memory | risk mirror, outcome link |
| **Change History & Outcomes** | every executed change with before/after metrics and verdict | §6 outcome loop | the loop itself |
| **Memory & Context** | review/confirm tenant facts the model proposed; set goals, margins, targets, do-not-touch | `markting_memory_facts` (new) | human confirmation UI |
| **Experiments** | holdout/geo tests, hypotheses, results | — | Experiment entity |
| **Creative Lab** | creative inventory, fatigue, Arabic variants | — | creative reads/normalizers |
| **Reports** | deterministic cadence reports, Arabic/RTL | `run_cadence_report` ($0, VERIFIED) | Arabic template/fonts (C5-05) |
| **Spend & Quotas** | per-org token/$ ledger, budgets, alerts | §1 gateway | metering middleware |

Every write module routes through the **one** human-gated, metered, observable path (the fixes in
§4 HUMAN APPROVAL/EXECUTION); no module may reach a provider through the generic `*_api_*` tools
(02 P1-02) — those are retired from the tenant runtime or gated off by default.

---

## 6. Performance / outcome loop (schema, DESIGN)

The loop that makes it a *media buyer*: `recommendation_id → approved → executed → before/after
metrics → window → actual vs expected → verdict`. Nothing in the code does this today (§4 OUTCOME/
LEARNING, MISSING). Seed is `markting_engine_proposals` (already org-scoped, RLS) plus the engine's
`measurement_plan`.

```
markting_decision_outcomes (
  organization_id        uuid    not null,          -- RLS, like markting_*
  recommendation_id      uuid    not null,           -- = proposal id
  revision               int     not null,
  pending_operation_id   uuid,
  tool, provider, account_ref, target_ref,           -- what was changed
  decision     text  not null,  -- applied | rejected | expired | unsupported | rejected_by_policy
  decided_by   text,            -- user id / api key owner (fixes C13-03 provenance)
  decided_at   timestamptz,
  before       jsonb,           -- metric snapshot at decision time (from reads)
  expected     jsonb,           -- the recommendation's predicted effect
  measurement_plan jsonb,       -- from ChangeSet.measurement_plan (parsed today, unused)
  measure_at   timestamptz,     -- decided_at + maturation window
  after        jsonb,           -- metric snapshot after the window
  window       jsonb,           -- {start, end, complete_through}
  verdict      text,            -- improved | neutral | worse | inconclusive
  measured_at  timestamptz,
  primary key (organization_id, recommendation_id, revision)
)
```

Mechanics (DESIGN): on apply, the cloud writes `before` + `expected` + `measure_at`; a scheduled job
(the pending sweep already exists but is never invoked, `repository.ts:420-425`, C12-07) sets
`expired` and, at `measure_at`, reads the tenant's accounts for the maturation window, writes `after`,
computes `verdict = f(actual vs expected, significance)`, and injects the last-N verdicts into the
next turn's memory brief (§2.2). **Governed learning:** only (a) user-confirmed facts, (b) measured
outcomes of applied decisions, and (c) accept/reject rates per tool/account used to *annotate or rank*
proposals ("similar changes were rejected 3× on this account") — never to change a policy limit,
approver set, or protected-account list. All learned state is visible and revocable by the org owner.
This closes DATA→…→LEARNING and is what turns the Recommendation Queue from suggestions into a system
that gets better.

---

## 7. Sequencing (DESIGN, dependency order)

1. **Safety gate (blocks live enablement):** enforce human approval on adport REST/MCP (P1-01);
   retire/gate generic `*_api_*` for agents + mirror risk classification (P1-02); per-org workspace/
   report/history isolation (P1-04); engine purge + retention (P1-05); atomic apply + idempotency +
   self-approval provenance (P2-04/07). Hermetic kill-switch path + behaviour CI (P3-05).
2. **Gateway safety items (§1.2 Option A):** usage ledger, caching, run deadline, allowlist, tracing,
   typed failure surfacing (P2-01/02/03/09).
3. **Connect the brain:** route live reads through adport's tenant runtime; Intelligence Layer brief
   + Marketing Memory facts (P1-03, GAP-01); Arabic/regional doctrine + locale policy + Arabic reports
   (GAP-02).
4. **Pipeline completion:** `explain_delta`/significance/decomposition + creative/frequency reads
   (SIGNAL DETECTION, GAP-03); intent-aware demo (P2-05).
5. **Outcome loop + Workbench (§5, §6):** decision-outcomes table, scheduled measurement, governed
   learning, the Workbench modules; evaluation framework with provenance grader in CI (P3-06).

Move to Option B gateway when step 3 goes multi-tenant.

---

## 8. Confidence and what was NOT verified

Confidence: **0.82** for the design's grounding in current code (every "today" cell in §4 and every
gap in §§1–3,6 is anchored in a VERIFIED_CODE/RUNTIME citation re-confirmed in `agents/C14.md`).
The forward designs are DESIGN, not verified by construction.

NOT_VERIFIED: gateway vendor features (LiteLLM per-virtual-key budgets/tag attribution; LangSmith
gateway fallback/budgets) — must be checked against current vendor docs before committing to Option
B/C; the real live-turn shape, cost, and Arabic model behaviour (no key); Postgres/Supabase
concurrency behaviour of the proposed atomic-consume and outcome-measurement jobs; pgvector Arabic
retrieval quality; and whether routing live reads through adport's tenant runtime fits the engine's
process-global profile without one process per tenant (the engine profile is process-global,
`assembly.py:189-195`, VERIFIED_CODE — this is the main open architecture question for step 3).
