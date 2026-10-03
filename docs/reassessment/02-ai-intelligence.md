# 02 — AI & Intelligence Assessment

**Lens:** AI architect. **Method:** static reading of `lib/markting/` @ `affdecc`, grep over `app/` and
`test/`. Tags: `VERIFIED_CODE` / `VERIFIED_TEST` / `BACKEND_ONLY` / `PARTIAL` / `MISSING` /
`BLOCKED_EXTERNAL`.

## Headline

**There are two disconnected worlds, and the one users actually hit contains no real AI.**

1. **Production assistant path** = a thin HTTP proxy to a Python engine that is a **scripted fixture
   replay** (no LLM). `assistant.ts` imports only `bridge`, `engine-client`, `env`, `runtime-mode`,
   `repository`, `runtime`. The one AI action is `client.sendMessage(threadId, text)` → the Python
   engine over HTTP; the only post-processing is turning a returned write *proposal* into a
   policy-gated preview. `engine-client.ts` targets `serve_demo.py`, which uses
   `LoopingScriptedChatModel`, model id `"scripted:demo"`. Cloud `package.json` has **no** anthropic/
   openai/litellm/langchain dependency. → the live assistant is a scripted demo, not an LLM.
   `VERIFIED_CODE`.
2. **A large, genuinely sophisticated deterministic TS "intelligence" stack** (diagnostics,
   recommendation, creative, commerce, optimize, memory, outcomes, learning, the AI gateway, the
   self-described "single intelligence path" `analyzeAndAnswer`) that is **imported only by test
   files** — wired into zero production routes. `service.ts`'s claim to be "THE single intelligence
   path" is aspirational: nothing calls it except `test/phase2-service.test.ts`. `VERIFIED_CODE`.

They do not compose. `assistant.ts` does not call any Phase 2–6 engine.

## Orchestration trace — "Why did profitability decline and what should I do?"

- **What the user gets:** text → `api/assistant/messages` → `runAssistantTurn` →
  `EngineClient.sendMessage` → `serve_demo.py` scripted model returns a canned investigation/proposal.
  Commerce profit, diagnostics, memory, experiment history — **none are read.** The answer is a fixture.
  `VERIFIED_CODE`.
- **The path that *could* answer it (unreachable):** `analyzeAndAnswer` → `analyzeAccount` runs
  log-ratio CPA/ROAS factor decomposition, anomaly, pacing, scaling, cross-campaign, health, then
  `generateRecommendations`, then narrates via the gateway. **But** (a) nothing calls it in prod;
  (b) even here the gateway returns deterministic local narration (`localFallback:true`) — no model;
  (c) **profitability is not even in this path** — `analyzeAccount` consumes ad metrics, not
  `commerce/*` profit/MER/COGS, which live in a separate untethered module set; (d) memory, outcome
  history, creative and experiment signals are **not passed** into `generateRecommendations`.
- **Conclusion:** the cross-domain question (profit = commerce + media + creative + experiments +
  history) has **no implemented composition anywhere** — not in prod, and not even in the test-only
  stack, which is siloed per phase. `VERIFIED_CODE`.

## Outcome learning — stores, does not use

`outcomes.ts` computes before/after with causal restraint; `learning.ts` aggregates per-dimension;
`memory-retrieval.ts` scores relevance — all good engineering. **The gap:**
`generateRecommendations` takes **no memory and no effectiveness/outcome input.** There is no closed
loop: nothing feeds calibration or past outcomes back to adjust confidence, suppress repeat-failing
categories, or re-rank. History is stored and queryable (in tests) but **never improves future advice.**
`VERIFIED_CODE`.

## AI gateway (`ai-gateway.ts`)

- **Model roles: only 3** — FAST_ANALYSIS / DEEP_ANALYSIS / REPORT_GENERATION. **No VISION, no
  EMBEDDING.** Multimodal reuses DEEP_ANALYSIS. → `PARTIAL/MISSING` vs a 5-role taxonomy.
- **Multi-provider routing: MISSING.** One descriptor per role from a static map; allowlist gates
  `scripted|anthropic|openai` but there is no selection logic.
- **Fallback: MISSING (provider fallback).** Retry loop retries the **same** model; "localFallback" is
  the caller returning a deterministic local result (the only path that ever runs).
- **Cost controls: PRESENT** — rolling-window quota (requests + cost), cost estimate, usage-ledger
  rows, idempotency. But all demo calls report `tokensAvailable:false` → cost 0; never validated against
  real token accounting. `BACKEND_ONLY`.
- **Caching: MISSING in base gateway** (only the multimodal wrapper has a content-hash cache).
- **Multimodal: scaffold, non-functional** — enforces size/duration limits + cache, but "no live
  multimodal model wired → metadata-only analysis (everything UNKNOWN)."
- **No live provider anywhere** — `DEMO_GATEWAY_CONFIG` maps all roles to `scripted`. The gateway is a
  governance seam that has never governed a real model call. `VERIFIED_CODE`.

## Are the "eval" suites real model evals? — NO

`ai-eval.test.ts` / `phase2..7-eval.test.ts` are **deterministic assertions over coded analysis
functions.** The files say so: *"The LLM narrates these governed signals; it does not compute them, so
correctness is asserted here on the layer that produces the numbers."* Representative:
`expect(...factors[0].factor).toBe('click_through')`, `expect(roas.from).toBeCloseTo(4)`. **No model is
invoked, no prompt, no judge.** They are high-quality unit tests of coded analytics, mislabeled "AI
Evaluation N.0". A genuine model-eval harness (prompts → model → scored outputs, hallucination/refusal
regression) is **MISSING**. The one genuine behavioural eval (`engine/tests/eval/run_questions.py`
against a live langgraph server) is a `__main__` script, not pytest-collected, so it **does not run in
CI**. `VERIFIED_TEST`.

## Prompt-injection / memory-poisoning posture — strong, but dormant

`memory.ts` has real code-level defenses: per-category source allowlist; `connected_source` may set
explicit facts only for structural keys (so attacker-controlled ad copy / campaign names / order notes
can never become a trusted fact); high-impact keys require human confirmation; trust ordering prevents
DERIVED overriding EXPLICIT_HUMAN; the LLM never writes memory directly. Red-team tests exist.
**Caveats:** this protects the **dormant** TS stack; the **live** scripted engine doesn't exercise it,
so the posture is unproven end-to-end (`PARTIAL`), and report/ad-copy/order-note content flows through
the external engine, outside these gates (`BACKEND_ONLY`).

## Top 10 AI gaps

1. **[P0]** No real AI in the shipped product — production assistant = scripted fixture replay; no LLM
   SDK in `package.json`.
2. **[P0]** The entire Phase 2–6 intelligence stack is unreachable from any route (only tests consume
   it).
3. **[P0]** No orchestrator composes domains — the cross-domain "why did profit decline" question is
   unanswerable even by the dormant stack.
4. **[P1]** No outcome→advice learning loop.
5. **[P1]** AI gateway has no multi-provider routing and no provider fallback.
6. **[P1]** "Eval" suites are unit tests, not model evals; no live-model regression gate.
7. **[P1]** Model-role taxonomy incomplete (no VISION/EMBEDDING; multimodal returns UNKNOWN stubs).
8. **[P2]** No response caching / embeddings / semantic retrieval (memory "retrieval" is substring
   scoring over JSON).
9. **[P2]** Governance seam never exercised against real traffic.
10. **[P2/P3]** Strong safety code is dormant; report/engine content path bypasses memory gates.

## Is the AI genuinely useful beyond deterministic analytics?

**No — and in the live product it is not even "AI."** What is real and valuable is the **deterministic
analytics engine** (log-ratio factor decomposition, evidence-gating/INSUFFICIENT_EVIDENCE discipline,
causal restraint, poisoning-resistant memory policy) — legitimately good and well-tested. But the "AI"
on top is (1) absent in production (scripted), and (2) in the dormant design, explicitly a **narrator**
that "never introduces a number or claim not already in the structured intelligence." By design the
model adds zero analytical value beyond phrasing; today it adds nothing because no model runs. The real
AI architecture — orchestration, live model, cross-domain reasoning, learning loop, real evals — is
**aspirational, test-only, and unwired.**
