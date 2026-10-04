# 10 — AI Agent Architecture Review

**Reviewer role:** Production AI-agent architect (independent)
**Date:** 2026-10-04
**Scope:** `platform/apps/cloud/lib/markting/ai-gateway.ts`, `lib/markting/intelligence/*`,
`lib/markting/orchestrator/*`, the assistant surface (`app/api/assistant`, `app/dashboard/assistant`),
the vendored `engine/` (paid-media-agent), the markting engine host
(`services/engine-demo/serve_demo.py`), and the AI test/eval suites under `platform/apps/cloud/test/`.
**Method:** every claim below is grounded in code I read in this repo. External facts are marked.

---

## 0. Headline verdict on the prior audit's thesis

**CONFIRMED, and sharper than stated.** The prior audit said the AI gateway is a *dormant governance
seam with a deterministic local narrator and no live model.* I verified this independently and it is
correct. I add three findings the one-line summary understates:

1. **No model SDK exists anywhere in the markting-authored code.** A repo-wide grep for
   `@anthropic-ai`, `from 'openai'`, `Anthropic(`, `OpenAI(`, `litellm`, `langchain` across
   `platform/apps/cloud` (excluding `node_modules`/`.next`/tests) returns **zero** hits. Every
   `AiGateway.invoke` caller's `run()` closure returns `{ usage: { tokensAvailable: false },
   localFallback: true }` — i.e. the governed "model call" is hard-wired to the local deterministic
   path. See `lib/markting/intelligence/service.ts:50-55`, `lib/markting/creative/multimodal-gateway.ts:52,65`.

2. **There IS a real LLM agent in the tree — but it is upstream, unmodified, and off by default.**
   `engine/` is a 1:1 vendored copy of `langchain-ai/paid-media-agent`
   (`UPSTREAM.md`: commit `0cc8109…`, "Nothing inside the imported trees was modified"). It is a real
   LangGraph "Managed Deep Agents" runtime that *can* call Anthropic/OpenAI/etc.
   (`engine/src/paid_media_agent/admin/model_presets.py`, `runtime/mda.py:configured_profile`
   "live providers only when their credentials exist"). The cloud talks to it over HTTP
   (`lib/markting/engine-client.ts`).

3. **In the shipped demo stack even the engine is scripted, not a model.** `docker-compose.yml`
   runs the engine with `MARKTING_ENGINE_MODE=demo` → `services/engine-demo/serve_demo.py`
   substitutes a `LoopingScriptedChatModel` (`paid_media_model: "scripted:demo"`,
   `serve_demo.py:84,180-200`) that *replays a fixed investigation and a fixed budget proposal*
   (`_exhausted_text()`, `serve_demo.py:124-128`). A live model requires the operator to set
   `MARKTING_ENGINE_MODE=live` + `PAID_MEDIA_MODEL` + an API key (all commented out in
   `.env.example`). The host even `assert_fail_closed`s on any live-write credential.

**Net:** the product ships today with **no LLM in any default path.** Every answer the Assistant,
dashboard and reports produce is **100% deterministic**. "AI" in the shipped product is a
conversational and narrative veneer over a genuinely substantial deterministic analytics engine. A
model is an *optional, un-wired narrator* (cloud path) or an *optional, un-wired upstream agent*
(engine path). Neither is a hypothetical: both seams are real and typed. But neither runs.

---

## 1. Deterministic-vs-LLM responsibility split

This is the single most important architectural fact, and it is **deliberate and well-drawn.**

| Responsibility | Owner | Evidence |
|---|---|---|
| Metric normalization, currency safety | Deterministic | `intelligence/normalize.ts`, `analyze.ts:195` |
| Diagnosis (what changed / why), evidence refs, confidence, risk | Deterministic | `intelligence/diagnostics.ts` (26 KB), `decision-model.ts` |
| Recommendations (typed review intents only) | Deterministic | `intelligence/recommendation.ts`, `decision-model.ts:118-143` |
| Cross-domain composition + factor ranking + next action | Deterministic | `orchestrator/orchestrator.ts:compose`, `scoreFactor` |
| Question → intent routing | Deterministic (regex) | `orchestrator/assistant-service.ts:36-68`, `intelligence/ask.ts:18-32` |
| Memory write policy / poisoning defense | Deterministic | `memory.ts:evaluateWritePolicy` |
| Narration (prose arrangement only) | **LLM, when present; else deterministic** | `orchestrator/answer.ts:80-132`, `intelligence/narrate.ts` |
| Governance (allowlist, quota, cost, idempotency, timeout, retry) | Deterministic gateway | `ai-gateway.ts:56-115` |

The contract is explicit and enforced: *the model narrates a structured object it may not alter;
it introduces no number or claim absent from the evidence* (`answer.ts:5-11,79-83`;
`narrate.ts:1-7`). `AssistantAnswer.source` is `LIVE_MODEL | LOCAL_FALLBACK | DETERMINISTIC_ONLY`
and a failed model yields `LOCAL_FALLBACK`, never a faked `LIVE_MODEL` (`answer.ts:108-131`). This is
the correct split for a high-stakes money domain, and it is **stronger than most production agents**:
the LLM is structurally prevented from being the source of a number a media buyer would act on.

The cost of this choice: the "intelligence" is only as good as the deterministic engines, and the
model today contributes **nothing** — not even rephrasing — because `deterministicNarrator.kind ===
'none'` is the only narrator ever constructed (`assistant-service.ts:73`,
`cloud/intelligence.ts:serviceForMode`). There is no `kind: 'live'` implementation in the repo.

---

## 2. What is REAL vs DORMANT

**REAL and shipping (deterministic):**
- A broad, genuinely substantive analytics engine: period comparison, contribution attribution,
  funnel decomposition, pacing, scaling/downscale readiness, anomaly detection (robust modified
  z-score, day-of-week deseasonalized — `analyze.ts:96`), trend classification, health dimensions,
  cross-channel comparability gating, creative fatigue, commerce reconciliation.
- The `MarketingIntelligenceOrchestrator` — one composition service producing one ranked
  cross-domain diagnosis with honest `DomainAvailability` for absent domains
  (`orchestrator.ts:159-238`). This answers the flagship "why did profitability decline" question
  deterministically, with explicit "merchant-side / ad-side / creative" attribution
  (`composeHeadline`, lines 109-131).
- Evidence grounding: every factor carries a `dataTrust` tier and `EvidenceRef` with the exact
  calculation string (`decision-model.ts:39-54`). Graded on every eval scenario (`harness.ts`).
- The governance gateway's real controls: provider allowlist, per-org rolling quota, idempotency by
  `request_id+feature`, timeout, bounded retry, usage ledger. All unit-tested
  (`test/ai-gateway.test.ts` — 8 cases incl. no-double-charge, quota rejection, trailing window).
- A 50-scenario eval harness (`orchestrator/eval/scenarios.ts`) and a 50-question executable
  media-buyer benchmark (`orchestrator/benchmark.ts`) with honest `NotNowClass` reasons.

**DORMANT (typed seam, no implementation):**
- `AiGateway` live-model transport — no provider client behind it.
- `ModelNarrator` with `kind: 'live'` — interface only (`answer.ts:80`).
- `MultimodalGateway` image/video analysis — returns metadata-only `UNKNOWN`
  (`multimodal-gateway.ts:49-52`). Visual understanding is not implemented.
- The engine's live model path (`MARKTING_ENGINE_MODE=live`) — off by default.
- Cost estimation (`estimateCostMicros`) — correct math, but always returns 0 because
  `tokensAvailable` is always false in every wired path.

**MISLEADING surface:** the chat UI placeholder differs for demo vs live
(`assistant-chat.tsx:89`), the route comment says "a live model turn can take minutes"
(`app/api/assistant/messages/route.ts:6`), and `maxDuration = 300`. These imply a live agent that,
in the default product, does not exist. A user could reasonably believe they are talking to an LLM.

---

## 3. Dimension scores (0–5)

| # | Dimension | Score | Basis |
|---|---|---|---|
| 1 | Deterministic/LLM responsibility split | **5** | Textbook; LLM structurally barred from computing facts (`answer.ts`, `narrate.ts`). |
| 2 | Evidence grounding | **5** | Every claim carries `EvidenceRef` + `dataTrust` + calculation (`decision-model.ts:39-54`); graded in harness. |
| 3 | Hallucination resistance | **5** (with caveat) | Perfect *because there is no generative model*. The LLM-narration seam enforces "no new numbers" but is **untested against a real model** (no live narrator exists to red-team). |
| 4 | Tool boundaries / write safety | **5** | Recommendations are typed review intents with no endpoint/body (`decision-model.ts:101-143`); engine is proposal-only (`serve_demo.py`), `FORBIDDEN_PATHS` block approve/edit (`engine-client.ts:61`); writes only via Phase-0 policy engine with four-eyes. |
| 5 | Orchestration | **4** | One coherent deterministic composition service; honest absent-domain handling. Not an agentic planner — it is fixed composition, by design. |
| 6 | Context quality | **4** | Context budget bounds large accounts by *materiality*, never silently dropping (`context-budget.test.ts`). Server-derived identity, never prose. |
| 7 | Memory | **4** | Typed, provenance-bearing, trust-ranked, poisoning-defended (`memory.ts`). But it only *informs deterministic recs*; no model reads/writes it, so its value is latent. |
| 8 | Model routing | **2** | Roles (`FAST/DEEP/REPORT`) and allowlist exist (`ai-gateway.ts:19-24,118-128`) but route to `scripted-demo` only; no real model, no real routing. |
| 9 | Fallback | **5** | Honest, fail-closed: engine-unreachable → deterministic orchestrator (`assistant.ts:52-71`); model-fail → `LOCAL_FALLBACK` never fake-live; empty/NOT_CONNECTED → truthful (`degraded-states.test.ts`). |
| 10 | Cost controls | **3** | Correct quota + idempotency + cost-estimate scaffolding, but untested against real token usage (always 0 today). Multimodal has a content-hash cache (`multimodal-gateway.ts:21`). |
| 11 | Latency | **3** | Deterministic path is fast; 300s budget + minutes-long comment anticipate a live model that does not run. No measured latency SLO. |
| 12 | Evaluation harness | **4** | Real framework: 50 scenarios graded on grounding/non-hallucination/safety; 50-q benchmark. **But** it grades only the deterministic layer; `LIVE_MODEL` mode is `BLOCKED_EXTERNAL` and `liveModelAvailable()` is hard-coded `false` (`harness.ts`), so the model narrator is never evaluated. |
| 13 | Prompt-injection defense | **5** | Strongest dimension. Campaign names/ad copy are data only; selection is numeric; injected `org=EVIL`/`actionType=REVIEW_PAUSE` never become control fields (`phase2-injection.test.ts`). Memory poisoning blocked by source allowlist + structural-key gate (`memory.ts:61-113`). Trivially robust *because there is no LLM in the loop* — this score would need re-earning once a live narrator exists. |
| 14 | Permissions / auditability | **5** | Tenant identity server-derived; AI preview recorded as `ai_agent` distinct from human approver (`assistant.ts:92`); usage ledger per org; source-isolation guard fails closed (`cloud/intelligence.ts:guardAnswerPosture`). |

**Dormant-capability dimensions (8, 10, 11, 12-live) score low not because the design is wrong but
because the thing being scored does not run.**

---

## 4. Does AI MATERIALLY improve a media buyer's decisions?

**The deterministic engine does; "AI" (an LLM) does not, today.**

- The decision value is real and comes entirely from the deterministic analytics: a buyer gets a
  ranked cross-domain diagnosis, evidence-cited factors, trust tiers, typed review recommendations,
  scaling/pacing/anomaly/forecast sections, and honest "insufficient evidence / not connected"
  states. That is materially more than a raw dashboard — it is *diagnosis and prioritization*, not
  just metrics. The 50-question benchmark's `ANSWERABLE_NOW` set is answered by real computed
  sections, asserted by predicate checks (`benchmark.ts`), not canned strings.
- **But the "AI" layer specifically — the LLM — contributes zero decision value in the shipped
  product.** It is a narrator that is never instantiated live. So the honest framing is: this is a
  **strong deterministic marketing-intelligence engine with an AI-shaped conversational wrapper and a
  fully-built but un-powered model seam.** It is *more* than "a conversational layer over dashboards"
  (the analytics are deep and the composition is novel), but the *generative AI* is, at ship, a
  conversational layer — and currently a scripted one.
- The deterministic design also means the product is **honest and safe by construction** where most
  LLM media-buying tools are reckless: no invented +23% ROAS, no autonomous writes, no injection
  surface. That is a genuine competitive strength, not a limitation to apologize for.

---

## 5. Strengths (top 5)

1. **Evidence-first, deterministic-core architecture.** Numbers come from audited engines; the model
   may only narrate. Correct and rare for this domain (`answer.ts`, `decision-model.ts`).
2. **Best-in-class prompt-injection and memory-poisoning posture** (`phase2-injection.test.ts`,
   `memory.ts`) — selection is numeric, content is data, sources are allowlisted.
3. **Honest degradation and source labeling** — `DETERMINISTIC_ONLY`/`LOCAL_FALLBACK` never faked
   live; NOT_CONNECTED/UNKNOWN never fabricated (`answer.ts`, `degraded-states.test.ts`,
   `cloud/intelligence.ts`).
4. **Real governance seam with real tests** — allowlist, quota, idempotency, usage ledger,
   four-eyes, proposal-only engine, forbidden approve/edit paths (`ai-gateway.ts`,
   `engine-client.ts:61`, `serve_demo.py`).
5. **Executable evaluation + benchmark discipline** — 50 graded scenarios + 50-question benchmark
   with honest not-answerable classification; the harness refuses to silently pass (`harness.ts`,
   `benchmark.ts`).

## 6. Gaps (top 5)

1. **No live model anywhere by default — the central "AI" promise is unfulfilled.** The cloud gateway
   has no provider client; the engine ships scripted. The product's generative AI is, at ship, a
   fixed script (`service.ts:50-55`, `serve_demo.py:124-128`).
2. **The model narrator is never evaluated.** The eval harness only grades the deterministic layer;
   `liveModelAvailable()` is hard-`false` (`harness.ts`). The "LLM adds no numbers" invariant is
   asserted structurally but **never red-teamed against an actual model**, so hallucination/injection
   resistance *of a live narrator* is unproven.
3. **No model routing or cost reality.** Roles map to `scripted-demo`; `estimateCostMicros` always
   returns 0 because `tokensAvailable` is always false. No real latency/cost SLO, no fallback-between-
   models logic (`ai-gateway.ts:118-128`, `estimateCostMicros`).
4. **Multimodal is a stub.** Creative visual/video "analysis" returns `UNKNOWN` metadata only
   (`multimodal-gateway.ts:49-52`); creative recommendations lean on CTR/series, not actual asset
   understanding.
5. **UX over-promises a live agent.** Placeholder copy, the 300s budget, and "a live model turn can
   take minutes" (`route.ts:6`) imply an LLM that is not running — a product-honesty risk for buyers
   who believe they are getting model reasoning.

---

## 7. Final verdict

**WOULD_USE_AS_SECONDARY_TOOL.**

Rationale: As a *deterministic marketing-intelligence and decision-support engine*, this is genuinely
useful, unusually safe, and well-engineered — a media buyer would benefit from its ranked diagnoses,
evidence trails, and honest uncertainty. But judged as an **AI agent** (the role of this review), the
generative layer does not exist in any shipping path: the model is an un-powered seam and the engine
ships a fixed script. I cannot score it `WOULD_USE_DAILY` as an AI product when there is no live AI,
and the one invariant that would make a future live model trustworthy (the narrator's grounding) is
untested against a real model. It earns well above `WOULD_PILOT` because the deterministic substance
is real, safe, and immediately valuable as a second opinion alongside a buyer's primary tooling — but
it is not yet the autonomous or model-reasoning agent the surface implies.

**To reach WOULD_USE_DAILY:** wire one governed `ModelNarrator(kind:'live')` behind the existing
seam; extend the eval harness to grade the live narration for added-number/injection violations
(flip `liveModelAvailable()`); make cost/latency real and measured; and align the UI copy with what
actually runs. The architecture is ready for all four — the seams are built; they are simply empty.
