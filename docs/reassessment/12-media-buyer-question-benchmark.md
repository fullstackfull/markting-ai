# 12 — Media-Buyer Question Benchmark (mandatory artifact)

**What this is:** 50 questions a real media buyer / agency operator asks, scored by whether a **human in
the product today** can actually get the answer. @ `affdecc`, static reading.

Legend — **A** = ANSWERABLE_NOW (reachable in a dashboard surface), **P** = PARTIALLY_ANSWERABLE
(reachable but manual/single-metric, or only via a live external MCP agent, or raw data only), **N** =
NOT_ANSWERABLE (test-only lib, external-only, or no connected data). "lib+test" = the capability is
`VERIFIED_TEST`/`BACKEND_ONLY` — built and tested but unreachable.

| # | Question | Verdict | Why |
|---|---|---|---|
| 1 | What did I spend in the last 7/30 days? | **A** | Overview tiles + Reports table |
| 2 | What's my blended ROAS? | **P** | Only if single currency; suppressed multi-currency |
| 3 | Which campaigns are running right now? | **A** | Campaign tables show status |
| 4 | Which campaigns spent with 0 conversions? | **P** | `zeroConversionSpend` rule — only if agent ran `audit_run` |
| 5 | Which campaigns have CPA far above median? | **P** | `cpaOutlier` rule — same caveat |
| 6 | Which campaigns are below break-even ROAS? | **P** | `negativeRoas` rule — same caveat |
| 7 | Which ads have low CTR on high impressions? | **P** | `lowCtr` rule — campaign-level, agent-triggered |
| 8 | Why did CPA rise yesterday? | **N** | No day-over-day diagnosis; `diagnostics.ts`/`anomaly.ts` lib+test |
| 9 | Where should I put another $1,000? | **N** | `optimize/allocation.ts` + `response-curve.ts` lib+test |
| 10 | What's the marginal ROAS of my next dollar? | **N** | `response-curve.ts` lib+test |
| 11 | Which campaigns are saturated? | **N** | saturation in `response-curve.ts` lib+test |
| 12 | Which campaigns can I scale safely? | **N** | `intelligence/scaling.ts` lib+test |
| 13 | Is my budget pacing on track today? | **N** | `intelligence/pacing.ts` lib+test; no surface |
| 14 | Will I overspend/underspend by month-end? | **N** | pacing/forecast lib+test |
| 15 | Why is Meta ROAS different from store MER? | **N** | No store connection; `commerce/*` + `cross-channel.ts` lib+test |
| 16 | What's my true profit/margin after COGS? | **N** | `commerce/profit.ts` lib+test; no store |
| 17 | What happened after your last recommendation? | **N** | `outcomes.ts`/`learning.ts` lib+test; no UI |
| 18 | Which clients need attention first? | **N** | No client tier / triage surface |
| 19 | Which creatives are fatiguing? | **N** | `creative/fatigue.ts` lib+test |
| 20 | Which creative should I refresh/kill? | **N** | `creative/recommendations.ts` lib+test |
| 21 | What's my frequency / am I over-saturating audiences? | **N** | frequency not normalized/rendered; Meta-only via agent |
| 22 | Which placements perform best (Meta)? | **P** | `meta_insights breakdowns` — agent/MCP only |
| 23 | What are my top search terms (Google)? | **P** | GAQL `search_term_view` — agent only |
| 24 | What negatives should I add? | **P** | `google_add_keywords negative` executes, but no suggestion engine in UI |
| 25 | What's my Search impression share / lost IS? | **P** | GAQL metric — agent only, not normalized |
| 26 | How is my PMax doing by asset group? | **N** | No PMax asset-group read/mgmt; create only (agent) |
| 27 | Pause this wasteful campaign | **P** | Only via agent/assistant proposal → Approvals apply |
| 28 | Raise budget on my best campaign | **P** | Agent→`set_budget`→approval; no UI control |
| 29 | Change bid strategy to target ROAS (Google) | **P** | `google_set_bidding_strategy` via agent→approval only |
| 30 | Create a new campaign | **P** | Agent create tools→approval; no UI builder |
| 31 | Launch a responsive search ad | **P** | `google_create_responsive_search_ad` agent-only |
| 32 | Show spend trend over time | **N** | No time-series chart; only point-in-time tables |
| 33 | Compare this week vs last week | **P** | Engine Report PDF gives spend+CPA deltas only |
| 34 | Break performance down by device/age/geo | **P** | Meta breakdowns / GAQL segments — agent only |
| 35 | Which audiences convert best? | **N** | `intelligence/audience.ts` lib+test |
| 36 | Attribution window sensitivity? | **N** | Hardcoded omni_purchase; no control |
| 37 | Cross-channel view of one customer journey | **N** | `intelligence/cross-channel.ts` lib+test |
| 38 | Portfolio spend across all clients/currencies | **N** | No roll-up; FX refused |
| 39 | Anomaly alerts (spend spike, conv drop) | **N** | `anomaly.ts` + `notifications.ts` lib+test; no feed |
| 40 | Forecast next month's results | **N** | `forecast.ts` lib+test |
| 41 | What's my CPM trend / is inventory inflating? | **P** | CPM computed but only inside findings/PDF, no trend |
| 42 | Weekly client report to send | **A** | Engine Report weekly PDF/HTML download |
| 43 | Which accounts am I connected to? | **A** | Connections + Accounts pages |
| 44 | Who changed what, when (audit trail)? | **A** | Audit log page + `recordAudit` |
| 45 | What's pending my approval? | **A** | Approvals page + Overview governance tile |
| 46 | Enforce "no budget change >20%" policy | **A** | Policies page + policy engine |
| 47 | Give my AI agent scoped access | **A** | Agents page API-key manager + MCP |
| 48 | Ask the assistant "why is performance down?" | **P** | Scripted fixture answer (demo) or external-agent (live) |
| 49 | Run an experiment / holdout test | **N** | `experiment-model.ts`/`sample.ts` lib+test |
| 50 | Dedup / cluster my creatives by theme | **N** | `creative/clustering.ts`/`dedup.ts` lib+test |

## Tally

- **ANSWERABLE_NOW: 8 / 50** (#1, 3, 42, 43, 44, 45, 46, 47) — all reporting + governance/ops.
- **PARTIALLY_ANSWERABLE: 16 / 50** — mostly "agent-only via MCP" (#22–31, 34) or single-metric/caveated
  (#2, 4–7, 33, 41, 48).
- **NOT_ANSWERABLE: 26 / 50** — and ~20 of those are features that **exist as tested lib code but are
  unreachable** (#8–17, 19–20, 32, 35–40, 49–50).

## Interpretation

The genuinely intelligent media-buying questions — diagnosis (8), allocation (9–11), scaling (12),
pacing/forecast (13–14), profit/MER (15–16), learning (17), creative (19–20), audiences/attribution
(35–37), portfolio (18, 38), anomalies (39), experiments (49) — are **almost all N**, and almost all of
those N's are backed by built, tested, dormant code. The product today answers the **reporting and
governance** third of a media buyer's day well, the **execution** third only through an external agent
+ approval, and the **analytical/decision** third essentially not at all in any human-reachable surface.

**8/50 answerable now is the single hardest number in this reassessment.** Wiring the dormant engines to
reachable surfaces is what would move this number — the brain for ~20 of the 26 N's already exists.
