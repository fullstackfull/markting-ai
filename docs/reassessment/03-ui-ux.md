# 03 — UI / UX & Product-Surface Assessment

**Lens:** frontend lead + product designer. **App:** `platform/apps/cloud/` (Next.js). **Method:**
static reading @ `affdecc`. Tags as elsewhere.

## Headline

**The UI exposes only a thin slice of the backend.** The deep-intelligence library
(`lib/markting/{creative,commerce,optimize,ops,intelligence,memory,outcome,playbook,learning,
usage-ledger}`) is imported by **zero** app files. The only `markting` modules any `app/` file imports
are `env`, `repository`, `bridge`, `runtime`, `runtime-mode`, `assistant`, `engine-client`. The cloud
app is a **governance + connection shell** over an external Python engine; everything intelligent is
reachable only by typing free text into the Assistant chat. There is no visual dashboard, chart, card,
or clickable surface for any of it. A media buyer cannot understand "what needs attention in 30
seconds."

## Information architecture (nav = `components/nav.tsx`)

**Primary:** Overview, Assistant, Connections, Accounts, Reports, Findings, Approvals, Audit.
**Utility:** Agents (API keys), Policies, Team, Billing, + Support widget.
**Non-dashboard:** `/`, `/login`, `/onboarding`, `/account-selection`, `/oauth/*`, `/auth/callback`,
`/mcp`. **API routes (~33):** account-access, account-selection, api-keys, approvals/apply+reject,
assistant/messages, billing/webhook, connections, dashboard/summary, deletion, locale, members, oauth
start+callback, onboarding, reports/engine, settings, support, v1/accounts, v1/tools/[tool], waitlist.
The public API surface (`v1/tools/[tool]`) exposes **only** provider ad tools from the policy-engine
registry — **not** any intelligence module (verified: the dispatcher route imports zero `markting/`
modules).

## UI visibility matrix (summary — full matrix in `11-ui-capability-matrix.md`)

**8 of 15 core capabilities are BACKEND_ONLY with no UI at all:** memory, outcomes, creative,
commerce/profit, experiments, optimization/allocation, kill switch; agency has only a billing
feature-flag. Approvals, Audit, Policies are fully wired; diagnostics/recommendations appear only as
inert finding text or chat prose; health shows only connection pills.

## The five user journeys

1. **Solo media buyer** (login → account → problem → recommendation → creative → experiment): login,
   connect, choose accounts all OK. Problem: no "what's wrong" surface, no prioritization.
   Recommendation: inert text in Findings, or type into chat. Creative: **CAPABILITY-NOT-EXPOSED.**
   Experiment: **CAPABILITY-NOT-EXPOSED.** → dead-ends at the value steps.
2. **Agency** (client-switch → portfolio → issue → approval): **client-switch MISSING** — shell shows
   one static org name, no dropdown, though the agency plan advertises `clientWorkspaces`. No portfolio
   roll-up. **Hard dead end at step 1.**
3. **E-commerce** (ads → revenue → refund → profit → recommendation): revenue/refund/profit all
   **CAPABILITY-NOT-EXPOSED** — no store connection, `commerce/*` unused, `live-data.tsx` only sums
   ad-side metrics. **Complete dead end for the commerce value prop.**
4. **Creative strategist** (library → hook → cluster → fatigue → test): **entirely
   CAPABILITY-NOT-EXPOSED** — no page, route, or nav item. Nothing to click. **Dead end at step 1.**
5. **CMO** (morning brief → business → risk → opportunity): closest surface is a downloadable PDF, not
   a brief; `intelligence/{risk,opportunity-center,forecast,anomaly}` have no UI. **Gap: no executive
   summary surface.**

## i18n / RTL, mobile, accessibility, design system

- **Arabic/RTL + English:** solid and consistent. Arabic is the default locale and RTL; logical CSS
  properties + `.mirror-rtl`; numerals forced Latin (`ar-u-nu-latn`) so metrics stay comparable — a
  good deliberate choice. **Consistency gap:** message namespaces exist only for the 12 shipped pages;
  none for creative/commerce/optimize/outcomes/memory (reflecting the missing UI).
- **Mobile:** responsive breakpoints at 1080/880/560/440; sidebar collapses at 880px; tables
  horizontal-scroll. **Weakness:** dense 7-column tables don't reflow to cards on phones.
- **Accessibility:** reasonable baseline (`aria-label`, `aria-current`, `aria-live`, `role=alert`).
  **Gaps:** tables lack `scope`/`<caption>`; metric tiles are plain divs; no skip-link observed.
- **Design system:** coherent, centralized (`components/ui.tsx` primitives + one `globals.css`), but
  **shallow** — no chart/sparkline/gauge/recommendation-card/diff primitive. **Dataviz is entirely
  absent**, which is the structural reason intelligence can't be surfaced even if wired.

## Onboarding

4-step flow (welcome → connect → accounts → agent) — complete and polished for its scope. **Gap:** the
final step teaches the user to connect an **external** agent (ChatGPT/Claude via MCP); it frames the
product as plumbing for someone else's AI and never introduces the in-product Assistant or any
intelligence surface. A new buyer finishes onboarding without ever seeing a recommendation, diagnostic,
or creative insight.

## Top 10 UI/UX gaps

1. **[P0]** The entire intelligence layer is invisible — reachable only by typing prose into one chat
   box.
2. **[P0]** No "what needs attention" surface — Overview is 4 raw tiles + two counts; no triage in 30
   seconds.
3. **[P0]** Commerce/profit journey is a dead end (no store connection/revenue/refund/MER/profit UI).
4. **[P0]** Creative strategist has nothing to click.
5. **[P1]** Agency multi-client switching is missing (paid feature with no UI).
6. **[P1]** Recommendations are inert text, not actions (no apply/dismiss queue/cards).
7. **[P1]** No experiments / optimization / allocation UI.
8. **[P2]** Health & kill-switch not surfaced (no emergency stop despite "always-on enforcement" copy).
9. **[P2]** Usage/cost invisible (billing shows plan tiers only).
10. **[P3]** Design system lacks any data-viz primitive; dense tables don't reflow on mobile.

## Bottom line

The governance/connection/approval half is well-built, consistent, bilingual (RTL-ready), and
mobile-aware. The analytical/AI half — where all the engineering depth lives — has essentially no
user-facing surface. Closing the gap requires **net-new pages and new design-system primitives**
(recommendation cards, charts, a client switcher, an attention/brief surface), not just wiring, because
the component library has no vocabulary for showing intelligence today.
