# 01 — Media-Buyer Reality Assessment

**Lens:** a skeptical senior media buyer / agency operator. **Method:** static code reading of
`claude/amazing-heisenberg-0unnak` @ HEAD `affdecc`. Every claim is tagged and (in the source audit)
cited to `file:line`. No app or test was executed at runtime in this container (no live providers, no
model, no browser harness), so nothing is tagged `VERIFIED_RUNTIME`.

## The one fact that drives everything

The product has **two separate "intelligence" layers that never meet**:

1. **The TS engine estate** — `lib/markting/{intelligence,optimize,creative,commerce,ops}/` (scaling,
   pacing, allocation, response-curve/marginal/saturation, fatigue, anomaly, forecast, cross-channel,
   commerce/MER/profit/reconciliation). **Imported by nothing except test files.** No `app/` route,
   page, or MCP handler imports them. → `VERIFIED_CODE` / `BACKEND_ONLY`.
2. **The live assistant brain** — an external Python service `services/engine-demo/serve_demo.py`
   reached over HTTP by `engine-client.ts` / `assistant.ts`. Its default is a **scripted demo** that
   replays a fixture investigation and one fixture budget proposal; live mode delegates to an upstream
   `paid_media_agent` package **not in this repo**. → `BLOCKED_EXTERNAL` / `DOCUMENTED_ONLY`.

**Consequence:** the sophisticated media-buying math that exists in this repo is test-covered library
code that **no user — human or agent — can reach through the product.**

## What a human buyer can actually reach (nav = 12 items)

- **Overview** — 4 tiles (7-day spend/clicks/conversions/ROAS) + a 12-row campaign table. Multi-currency
  deliberately **not** blended (ROAS suppressed, "we never invent an FX rate").
- **Reports** — a 30-day flat campaign table + an "Engine Reports" runner that POSTs to the Python host
  and returns weekly/monthly PDF/HTML with per-platform spend + CPA deltas only.
- **Findings** — a table of persisted findings from a **4-rule** audit pack (zero-conv-spend, low-ctr,
  cpa-outlier, negative-roas), populated **only if an external MCP agent called `audit_run`** — no
  dashboard button runs it.
- **Assistant** — chat → Python engine; write proposals become approval previews.
- **Approvals / Audit / Accounts / Connections / Policies / Team / Agents / Plan** — governance/ops.

The real "power user" surface is **MCP** (`app/mcp/route.ts`): an external agent, authenticated by an
API key, calls the full provider tool set. **A human in the dashboard cannot run an insights query,
change a bid, see a breakdown, or create a campaign** — those exist only as MCP tools for an agent, or
as scripted assistant demos.

## Provider capability ranking (raw-API / MCP tier)

Tiers: CONNECTOR_ONLY < READ_BASIC < READ_ADVANCED < INTELLIGENCE_READY < ACTION_READY.
**No provider is INTELLIGENCE_READY** — provider packages carry zero media-buying intelligence; all
tools are raw read + policy-guarded write.

| Rank | Provider | Tier | Notes |
|---|---|---|---|
| 1 | **Google** | ACTION_READY | arbitrary GAQL read; create Search/Display/Shopping/Video/PMax, set bid ceiling, bidding strategy (tCPA/tROAS/MaxConv/MaxConvValue), ad groups, keywords + negatives, RSAs |
| 2 | **Meta** | ACTION_READY | `meta_insights` all levels + breakdowns; create campaign/ad set, budgets, status, generic edge CRUD |
| 3 | **Apple (ASA)** | ACTION_READY | generic read + campaigns; create campaign/ad group/keyword/budget |
| 4 | **TikTok** | READ_ADVANCED + ACTION | generic read + campaigns + report |
| 5 | **Reddit** | READ_ADVANCED + ACTION | generic read + campaigns + report |
| 6 | **Microsoft** | READ_BASIC + ACTION | generic read + campaigns; CSV import; no report tool |
| 7 | **Snapchat** | READ_BASIC + ACTION_BASIC | list campaigns only; campaign-level CRUD |
| 8 | **Pinterest** | READ_BASIC + ACTION_BASIC | list campaigns only |
| 9 | **LinkedIn** | READ_BASIC + ACTION_BASIC | list campaigns / groups |
| 10 | **X** | READ_BASIC + ACTION_BASIC | list campaigns / funding / line items |
| 11 | **Spotify** | READ_BASIC + ACTION_BASIC (draft) | list campaigns; create draft only |

**Normalized cross-provider schema** (`packages/core/src/model.ts`): spend, impressions, clicks,
conversions, conversion_value, ctr, cpc, cpm, cpa, roas; levels account/campaign/ad_group/ad.
**No frequency, reach, impression_share, search_terms, or placement in the normalized schema** — those
are reachable only per-provider via raw read tools, never cross-provider, never in the UI.

**Verdict:** Google/Meta are genuinely deep *at the raw-API/MCP tier*; Snapchat/Pinterest/LinkedIn/X/
Spotify are thin campaign-level CRUD. But **capability depth ≠ buyer value**: none of it is wrapped in
reachable media-buying intelligence.

## Agency ops at 50 clients / 150 accounts / multi-currency

- **No client/brand tier.** Model is `organizationId` → ad accounts; no portfolio grouping, no
  cross-client roll-up, no "book of business" view. 50 clients = 50 orgs or 150 flat accounts. **P1**
- **Active-account cap is a plan entitlement**; at scale you get a flat list, no triage. **P1**
- **Multi-currency intentionally un-aggregated** — correct for integrity, but no single portfolio number
  anywhere and no reachable FX engine (`optimize/fx.ts` is test-only). **P1**
- **No bulk operations, saved views, scheduled/emailed reports, or alert feed.** **P2**
- Governance scales well (per-org policy engine, approvals, audit, RBAC, kill-switch, write-lockdown).

## Top 10 media-buyer product gaps

1. **[P0]** The entire intelligence/optimize/creative/commerce engine is unreachable (imported only by
   tests). *This is the product.*
2. **[P0]** The live assistant brain is external/scripted, not this repo's engine — a buyer asking "why
   did CPA rise?" gets a canned script.
3. **[P0]** No budget-allocation / "where do I put the next dollar" surface despite a tested
   response-curve + allocation engine.
4. **[P1]** No campaign/ad management or performance drill-down UI — can't pause, change a bid, or see
   ad-level/breakdown data without an external agent.
5. **[P1]** No commerce/store connection → no MER, profit, or reconciliation (kills ROAS-vs-MER and
   true-profit questions).
6. **[P1]** No creative-fatigue / creative-performance surface despite built `creative/*`.
7. **[P1]** No pacing / budget-burn / anomaly-alert feed — agencies fly blind intra-day.
8. **[P1]** No agency portfolio layer (client grouping, roll-up, triage, FX aggregation).
9. **[P2]** Findings require an external agent to trigger `audit_run`; only 4 campaign-level rules.
10. **[P2]** No outcome/feedback loop in UI — cannot demonstrate learning.

## Bottom line

An impressively **governed execution-and-connectivity rail** (strong policy engine, approvals, audit,
RBAC, kill-switch, 11 connectors, deep Google/Meta raw-API coverage) with a **large, well-tested, but
entirely dormant media-buying intelligence library wired to nothing a buyer touches.** Today it answers
reporting and governance questions well and can *execute* agent-proposed changes safely, but it cannot
perform the daily analytical work of a media buyer in any surface a buyer touches. The gap between
`VERIFIED_TEST` and `UI_EXPOSED` is the whole product opportunity.
