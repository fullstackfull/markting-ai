# 10 — Independent Red-Team Assessment

**Lens:** maximally skeptical outsider asked "would you refuse to call this a usable product today, and
why?" **Method:** verified against code, not docs, @ `affdecc`. Tags as elsewhere.

## What was verified (reproducible evidence)

1. **The app surface is tiny and fixed.** `components/nav.tsx` defines exactly 12 destinations
   (Overview, Assistant, Connections, Accounts, Reports, Findings, Approvals, Audit, Agents, Policies,
   Team, Billing). The `app/dashboard/*` route tree contains pages for exactly those and nothing else.
   **No creative-intelligence page, no commerce/profit page, no experiments page, no
   recommendations/opportunity center.** `VERIFIED_CODE`.
2. **The entire "intelligence" product is dead code relative to the app.** The only `lib/markting/*`
   modules any `app/` file imports are `assistant, bridge, engine-client, env, repository, runtime,
   runtime-mode`. Zero `app/` files import `intelligence/`, `creative/`, `commerce/`, `optimize/`, or
   `ops/` (neither `@/` nor relative). Those five trees total **89 of 118 `.ts` files in `lib/markting`**
   (intelligence 29, commerce 17, ops 17, optimize 15, creative 11). Their only consumers are each other
   plus a handful of other orphan lib files — none of which reach `app/` either. A self-referential
   island. `VERIFIED_CODE`.
3. **"Ask AI" uses only the Phase-0/1 engine bridge, not the intelligence layer.** `assistant.ts`
   forwards text to an external HTTP `EngineClient` and renders exactly one structured artifact: a
   `BridgeCard` budget-proposal preview. No creative/commerce/experiment/forecast/recommendation output
   is referenced in the component's types. `VERIFIED_CODE`.
4. **The "engine" behind Ask AI is a scripted demo.** `engine-client.ts` points at `serve_demo.py`,
   which "runs a scripted analysis and a simulated budget change against synthetic data." The launch
   exit report itself admits "Live model tested — NO (BLOCKED_EXTERNAL)." No live LLM is wired as a
   product integration. `VERIFIED_CODE` + `DOCUMENTED_ONLY`.
5. **Live data: partially real on the read path, nothing on the write/AI path.** `reports/page.tsx` /
   `live-data.tsx` go through `createTenantRuntime` to real provider SDKs — so if a customer
   OAuth-connects, they would see real read-only spend/clicks/ROAS. But the launch report admits live
   providers and commerce are `BLOCKED_EXTERNAL`/"FIXTURE_PROVEN"; default engine URL is `127.0.0.1:8080`
   serving hardcoded fixtures. `PARTIAL`.
6. **The "Findings" page can never populate from the live app.** `PostgresFindingsStore.save()` is never
   called by any non-test code path; the Findings page only `.list()`s. A real customer sees a
   permanently empty Findings tab (unless an external MCP agent runs `audit_run`). `VERIFIED_CODE`.

## Per-persona: "why I'd refuse today"

- **Senior media buyer** — the only thing the AI can DO is propose one budget change for me to approve.
  No creative-fatigue view, no reallocation UI, no pacing alerts. Every "intelligence" feature is
  unreachable. I won't move spend decisions onto a tool whose AI is a scripted demo.
- **AI architect** — 89/118 `lib/markting` files are imported by zero app files; "Ask AI" bypasses all
  of it for a demo HTTP engine. A backend built to a spec with no product seam. Not an "AI platform."
- **Frontend lead** — 12 pages, most governance/admin. The value surface is two read-only table pages
  plus a one-trick chat. Findings is dead. No UI for the headline capabilities.
- **SaaS founder** — the exit report concedes no live model, providers, commerce, hosting/TLS/queue/KMS.
  Nothing to sell a seat to today. Pre-revenue infrastructure, not a product.
- **Agency owner** — ops/governance code exists but isn't surfaced beyond basic Accounts/Team; providers
  aren't live-tested; no creative/experiment workflow to show clients. No reason to switch.
- **Data scientist** — the forecasting/experiment/allocation engines are real in code but I can't reach
  them, can't feed them live data (fixtures only), and can't see their output anywhere.
- **Customer** — I sign up and get a connections screen, read-only tables (only with working OAuth,
  untested live), an empty Findings tab, and a chatbot that suggests one budget tweak. Nothing matches
  the marketing. I'd churn.

## Single most damning finding

**The product's entire advertised intelligence — creative, commerce/profit, experiments, optimization,
recommendations (89 of 118 `lib/markting` source files) — is imported by ZERO files under `app/`, and
"Ask AI" routes around all of it to a scripted demo engine.** The impressive Phase 2–6 code physically
cannot be invoked by any user action. The gap between the exit reports and the usable app is near-total.

## Verdict

**MARKTING-AI today is a strong, honestly-documented backend awaiting a product — not a usable
product.** The engineering (governed write path, RLS/tenant isolation, policy/approval gate,
deterministic analysis engines, sandbox) is substantial and the exit reports are refreshingly candid
about what is fixture/blocked. But as a thing a customer can log into and get value from today, it is:
read-only report tables (only with untested live OAuth) + an approval/audit governance shell + a
one-proposal demo chatbot. Everything that would justify paying for an "AI marketing intelligence
platform" is either unreachable code or explicitly `BLOCKED_EXTERNAL`. **Not shippable as a paid product
today; it's a platform skeleton plus a large detached brain.**

*Where the red-team and the other teams agree:* this is the central, repeatedly independently-derived
finding of the entire reassessment. No team dissents from it.
