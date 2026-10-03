# 01 — Media-Buying Gap Analysis (Executive View)

> Author: A16, Head of Paid Media. Synthesis of the eleven channel specialists (A1–A11) and the four
> cross-cutting specialists (A12 e-commerce/profit, A13 attribution, A14 creative, A15 budget/scaling).
> Every classification is backed by a `path:line` citation taken from a specialist report and, for at least
> seventeen of them, re-verified by A16 re-opening the file (log in `docs/audit/agents/A16.md`). Companion:
> `docs/audit/09-media-buyer-capability-matrix.md` (channel × capability grid).
>
> **Classification key:** EXISTS_AND_STRONG · EXISTS_BUT_LIMITED · PARTIAL · MOCK_ONLY ·
> DOCUMENTED_NOT_IMPLEMENTED · MISSING · UNSAFE_TO_AUTOMATE.

---

## 1. One-paragraph verdict

MARKTING-AI is a **well-engineered, policy-gated remote-control and reporting layer over eleven ad platforms
— and almost nothing a senior media buyer would recognize as *buying*.** The safety machinery (two-step
validate→apply gate, hash-bound pending operations, protected accounts, account-scoping, append-only audit,
forced-paused creation) is genuinely strong and consistently applied, and the per-channel OAuth/transport
code is careful. But the *analytical* and *economic* substance a buyer needs is thin to absent: reporting is
a fixed 10-metric, campaign-grain, last-touch, platform-attributed vocabulary with no breakdowns, no audience
/ placement / creative intelligence, no business revenue, no profit, no MER/CAC/LTV, no forecasting, no
scaling or allocation logic, and no memory of past recommendations or their outcomes. The "AI engine" can
only *fully reason about five of the eleven channels* (Meta, Google, Reddit, LinkedIn, X), and for several
channels it cannot read a single number offline. On top of that sit a handful of real P0/P1 defects — a
currency-unit bug that can create a 100× budget, two account-scope/policy bypasses, a path that reaches
permanent deletion, a cross-platform ROAS that sums non-comparable attribution, and a conversion-zeroing
behaviour that can auto-propose pausing healthy campaigns. **A senior buyer could use this to look, with
care; they could not use it to run accounts unsupervised, and they could not trust its headline economics.**

---

## 2. What a senior buyer *can* do (and the asterisks)

| Capability | Classification | Evidence (spot-checked where ✔) |
|---|---|---|
| Pull campaign-grain spend/impressions/clicks/conversions/value + ctr/cpc/cpm/cpa/roas, per channel | EXISTS_BUT_LIMITED | 11 providers map a native metric set; Meta `omni_purchase` ✔ `platform/packages/meta/src/provider.ts:201-215`; Google ✔ `.../google/src/provider.ts:27-33`; etc. (matrix fn.6) |
| Discover accounts/campaigns (within the OAuth-frozen enabled set) | EXISTS_BUT_LIMITED | `platform/apps/cloud/lib/cloud/account-scope.ts:68-72` ✔ (never re-enumerates; filters to allowed set) |
| Change a **campaign** budget or status, or create a forced-paused campaign shell, behind a two-step gate | EXISTS_AND_STRONG (safety) / EXISTS_BUT_LIMITED (scope) | `guardedWriteTool`→`PolicyEngine.validate/apply`, `platform/packages/core/src/policy/engine.ts:133-153` ✔; budget caps, hash binding, TTL, audit |
| Google: MCC-hierarchy account walk; raw GAQL reads | EXISTS_AND_STRONG | `platform/packages/google/src/provider.ts:62-128,240-249` (A2) |
| Compare two time windows (spend/CPA/ROAS deltas) with reconciliation guards | EXISTS_AND_STRONG | `engine` `compute.py:98-114,375-422` (A15) |
| Get generic anomaly flags (zero-conversion spend, low CTR, CPA outlier, ROAS<1) | EXISTS_BUT_LIMITED | `platform/packages/core/src/audit/packs/core-performance.ts:76-99` ✔ |
| Have the engine refuse to convert currencies or total mixed-currency artifacts | EXISTS_AND_STRONG (honest refusal) | `engine` `compute.py:309-331`; `reporting-semantics.md:9,15` (A12/A13) |

**The asterisks:** reporting is last-touch, platform-attributed, campaign-grain, totals-only; the "safe"
writes only reach the *campaign* level on most channels (no ad-group/ad-set budget on TikTok, no ad-group
budget non-CBO on Reddit, no lifetime budgets on several); and the strong gate protects *execution*, not the
*quality of the recommendation* flowing into it.

---

## 3. What a senior buyer *cannot* do — the capability gaps

### 3.1 Economics (the core of the "AI media buyer" promise) — MISSING

A16 ranks this the single largest gap. The product optimizes **platform-reported conversion value**, which
is not the business's money.

| What's missing | Classification | Evidence |
|---|---|---|
| Store revenue (Shopify/Salla/Zid/WooCommerce) | MISSING | A12-08; `docs/TODO.md` §3 ✔ "Nothing exists yet … so ROAS uses real revenue, not platform-attributed conversion value" |
| Orders / AOV / new-vs-returning | MISSING | A12; no entity in `model.ts` / `domain/metrics.py` |
| Refunds, returns, COD rejection | MISSING | A12 (grep: zero hits) |
| COGS / gross-vs-net / contribution margin / profit per order | MISSING | A12 |
| CAC (customer acquisition cost) | MISSING | A12 — CPA on platform conversions exists, no customer identity |
| MER / true blended ROAS (store revenue ÷ total spend) | MISSING | A12-04; the only "blend" sums platform-attributed value: `engine` `compute.py:_combine` ✔ |
| LTV | MISSING | A12 |
| Break-even ROAS with a margin input | PARTIAL / mislabelled | `core-performance.ts:76-99` ✔ equates break-even with a constant `roas < 1`; no margin anywhere (A12-03) |
| Business-data / warehouse / CRM join | DOCUMENTED_NOT_IMPLEMENTED | `engine/docs/customization.md:157-175` describes how a coder *could* add it; nothing reaches `compute.py` |

### 3.2 Attribution integrity — PARTIAL to MISSING, and actively unsafe when blended

| What's missing | Classification | Evidence |
|---|---|---|
| Per-row attribution-window transparency | PARTIAL | only Snap/Pinterest hard-code+document windows (`snapchat` fixed 28d/1d; `pinterest/src/provider.ts:92`); Meta/Google/TikTok/MS use silent account defaults; `ReportRow`/`PerformanceRow` have no attribution field (A13) |
| Click-through vs view-through split | MISSING | Reddit sums both ✔ `platform/packages/reddit/src/provider.ts:230`; Snap/Pinterest/LinkedIn include view; Google/MS exclude; nothing exposes the split (A13) |
| Cross-channel dedup / multi-touch / UTM / click-id / server-side conversions / pixel health | MISSING | A13-13 (negative grep); dedup documented as not done `reporting-semantics.md:31` |
| Incrementality / holdout / geo-lift | DOCUMENTED_NOT_IMPLEMENTED | `metrics-and-attribution.md:39-43` (prose only) |
| Conversion-lag / incomplete-window flagging in live mode | MOCK_ONLY | `data_complete_through` set only by fixtures `engine` `fixtures.py:201-214` (A13-03) |

**Active hazard:** the engine's cross-platform total sums `conversions`/`value` across channels with different
attribution definitions and windows and emits a single blended CPA/ROAS, with the attribution-mismatch flag
never set (A13-01/A13-05; `_CONVERSION_KEYS=("conversions","purchases","results")` ✔ `engine` `normalize.py`).

### 3.3 Creative intelligence — MISSING entirely

No creative entity, attribute, or table exists anywhere; no hooks/angles/offers/CTA taxonomy; no
landing-page intelligence; no fatigue (no reach/frequency in the metric model); no winner detection below
campaign grain; no clusters, lifecycle, or testing (A14-01…A14-08). Engine prompts even instruct the model
about a `get_creative_performance` tool and "creative fatigue" that the shipped catalog does not contain
(A14-03) — a documentation-vs-code contradiction that will produce confident, ungrounded creative answers.

### 3.4 Budget / scaling / allocation — PARTIAL pacing, otherwise MISSING

Daily pacing and a ±50% day-over-day flag exist in the engine (`summary.py:88-104,120-124`, A15), but:
horizontal reallocation, vertical scale rules, marginal-ROAS / diminishing-returns, audience saturation, and
account/channel budget allocation are all MISSING or prose-only (A15-06; scale number hard-coded in
`demo_script.py:166`). There is no forecasting of any kind.

### 3.5 Channel breadth of the *AI engine* — the brain is blind to six of eleven channels

The adport platform layer has connectors for all eleven. The **engine** (where normalization, comparison,
anomaly and proposal logic live) can only turn five channels into its cross-platform model —
`PERFORMANCE_PLATFORMS = {GOOGLE_ADS, META_ADS, REDDIT_ADS, LINKEDIN_ADS, X_ADS, OPENAI_ADS}` ✔ (`engine`
`normalize.py`). TikTok, Snapchat, Microsoft, Pinterest, Spotify and Apple have **no engine data path** —
no fixture, no normalization, and (for several) no admitted writes or bridge mapping (A3-07, A4-09, A8-04,
A6-01, A10-01, A11-14). For those channels the "AI media buyer" cannot state a single number offline and can
only store raw Pipeboard payloads live.

### 3.6 Memory — the system does not learn

Historical learning, recommendation tracking, and outcome tracking are all MISSING (matrix fns. 18–20). The
audit log records executed writes, not recommendations or their results; nothing links an action to its
measured effect. Period-over-period comparison exists but is not a learning loop.

---

## 4. Defects a senior buyer must know about (consolidated, deduplicated, final severities)

> Full evidence per item in the cited specialist report. Severities re-adjudicated by A16.

| ID | Sev | Title | Source | Evidence |
|---|---|---|---|---|
| F-01 | P0 | Zero-decimal currency (JPY/KRW…) produces a 100× budget | A15-01, A1-02 | `CENTS_TO_MICROS=10_000` 2-decimal assumption; A15 `engine.ts`/A1 `meta/src/provider.ts` |
| F-02 | P0 | Typed Meta status/budget writes never verify the object belongs to `account_id` (policy + scope bypass) | A1-01 | `platform/packages/meta/src/provider.ts:372-391`; typed tools skip ownership check |
| F-03 | P0 | `protected_accounts` bypassable for Google by reformatting the customer id | A2-02 | `platform/packages/core` policy id match vs Google id formatting |
| F-04 | P0 | Workspace-scope bypass: Reddit single-resource reads, TikTok `advertiser_id`-only, Microsoft customer-mgmt reads enumerate beyond the enabled set | A9-02, A3-03, A8-03 | `reddit/src/provider.ts`; `tiktok/src/provider.ts:437-443`; `microsoft` customer-mgmt |
| F-05 | P0 | `apple_upload_asset` is an arbitrary server-file read + SHA-256 oracle in the multi-tenant runtime | A11-01 | `platform/packages/apple/src/...` upload path |
| F-06 | P1 | Generic `tiktok_api_update` reaches permanent deletion (TikTok deletes via `*/status/update`+DELETE) | A3-01 | `platform/packages/tiktok/src/provider.ts` (DELETE excluded from typed enum but reachable) |
| F-07 | P1 | Cross-platform blended ROAS/CPA sums non-comparable attribution/windows; mismatch flag never set | A13-01, A13-05, A12-04 | `engine` `compute.py:_combine` ✔; `normalize.py` `_CONVERSION_KEYS` ✔ |
| F-08 | P1 | Conversions coerced to 0 (not null); `zero-conversion-spend`/`negative-roas` then auto-propose pausing healthy campaigns | A13-04, A1-03, A6-03, A9-04, A4-02, A11-03 | `core-performance.ts:76-99` ✔; provider zero-coercion ✔ (Meta/Apple spot-checked) |
| F-09 | P1 | Budget policy evaluated at validate time only; apply re-plans against fresh state (cap race) | A15-04, A2-09, A6-10, A10-09, A11-13 | `policy/engine.ts:133-153` ✔ (only protected-accounts re-checked at apply) |
| F-10 | P1 | Absolute budget cap is currency-blind; pct cap silently bypassed when prior budget unknown; default policy has no absolute ceiling | A15-02, A15-03 | `policy/engine.ts:140-151` ✔ (`fromMicros>0` guard skips pct cap) |
| F-11 | P1 | Cloud overview ROAS tile is structurally `0×`; overview totals sum spend/value across currencies | A12-01, A12-02, A13-06 | `platform/apps/cloud/lib/cloud/reads.ts:54` ✔ (`conversion_value` not requested) |
| F-12 | P1 | AI engine cannot read six of eleven channels (TikTok/Snap/MS/Pinterest/Spotify/Apple): no fixture, no normalization | A3-07, A4-09, A8-04, A6-01, A10-01, A11-14 | `engine` `normalize.py` `PERFORMANCE_PLATFORMS` ✔; `common.py` `FIXTURE_PLATFORMS` |
| F-13 | P2 | Reporting silently truncated then labelled `complete`/no `truncated` (Google 10k GAQL rows, TikTok page-1-only, Microsoft) | A2-01, A2-08, A3-05, A8-07 | `google/src/provider.ts`; `tiktok/src/provider.ts:211-219`; `microsoft/src/provider.ts` |
| F-14 | P2 | No attribution-window transparency; windows hidden and mixed when totaled; timezone mismatch ignored | A13-05, A13-07, A6-05, A4-06 | `ReportRow` has no attribution field; provider fixed/default windows |
| F-15 | P2 | Several channels create non-servable campaigns (Google accepts PMax/Shopping/Video but builds Search; Snap/Pinterest/X/MS shells; objective unvalidated) | A2-06, A4-08, A6-?, A8, A7 | `google/src/tools.ts:41` ✔ (enum present); A2-06 |
| F-16 | P2 | Derived ratios return 0 (not null) on zero denominators, misreporting CPA/CPC/CPM as "free"/ROAS as unavailable=0 | A6-03, A4-02, A11-03 | provider derived-metric blocks ✔ (Apple `roas:0`, Pinterest DERIVED) |
| F-17 | P2 | Per-provider "conversion" definitions differ (purchase vs lead vs install vs checkout vs account-defined) and the UI never says which | A13, A12-09, A5-01, A5-04 | provider metric maps ✔; LinkedIn website-only `provider.ts:7` ✔ |
| F-18 | P2 | No retry/backoff on rate limits; token refresh on every runtime assembly (Pinterest/Apple/Snap/Reddit) | A6-11, A11-08, A4-10, A9-08 | provider client code |
| F-19 | P3 | Docs contradict code: `doctor` says LinkedIn is a direct adapter (routes via Pipeboard); Apple docs say v5 (code v1); "always paused" is policy-only; Snap doc claims | A5-03, A11-16, A2-04, A4-11 | respective provider docs vs code |
| F-20 | P3 | Gated providers OFF by default when `.env.example` is copied (LinkedIn, Pinterest, Spotify, TikTok rollout gate) | A5-08, A6-13, A10-10, A3-14 | `.env.example`; `provider-rollout` |

**GAP (not defects, but the product claims nowhere to provide them):** store revenue/profit/MER/CAC/LTV
(§3.1), creative intelligence (§3.3), forecasting/scaling/allocation (§3.4), attribution dedup/multi-touch
(§3.2), engine coverage of six channels (§3.5), learning/outcome tracking (§3.6).

---

## 5. What a world-class "AI media buyer" would need (concrete, prioritized)

1. **A business-truth layer (highest value).** Read-only store/CRM connectors (Salla, Zid, Shopify,
   WooCommerce) feeding orders, revenue (gross/net ex-VAT/refunds), COGS/margin, new-vs-returning — joined to
   spend so the system optimizes **MER, CAC, contribution margin and profit**, not platform-attributed value.
   The code already names this as the plan (`docs/TODO.md` §3) but nothing exists.
2. **Attribution correctness before any blending.** Stamp every row with its window and conversion definition;
   refuse to sum across incompatible definitions (the engine already refuses mixed currencies — extend the
   same discipline to attribution); add UTM/click-id capture and a pixel/CAPI health check; stop coercing
   missing conversions to 0 (fix F-08 at the provider layer, not just in docs).
3. **Creative intelligence subsystem.** A creative entity (format, text, media, landing URL, Arabic/RTL), ad-
   level performance with reach/frequency for fatigue, winner detection with significance, and lifecycle
   state — none of which exist today.
4. **Breakdown and audience analytics as first-class, tested, normalized paths** (placement/geo/device/
   demographic/time), not raw passthrough that nothing consumes.
5. **Decision intelligence:** marginal-ROAS / diminishing-returns curves, budget sizing, cross-channel
   allocation, and forecasting — replacing today's qualitative "consider reducing budget".
6. **A memory loop:** persist every recommendation, its approval decision, and its measured outcome, and feed
   that history back into future recommendations (recommendation + outcome tracking, currently MISSING).
7. **Engine parity across all eleven channels** (fixtures + normalization + write bridge), so the brain is not
   blind to six of them.
8. **Close the P0/P1 safety defects in §4** (currency units, scope/policy bypasses, deletion path, apply-time
   budget re-check) before any further unattended automation.

---

## 6. Disagreements / claims in docs the code contradicts

- **"Real ROAS."** Marketing/overview framing implies ROAS; the overview tile is structurally `0×`
  (`reads.ts:54` ✔) and the only revenue is platform-attributed conversion value, which `docs/TODO.md` §3
  itself admits is "not real revenue."
- **`doctor` / adapter topology.** A5-03: `doctor` tells operators LinkedIn is a direct adapter; the engine
  routes it through Pipeboard. A11-16: Apple docs say Campaign Management API v5; code is on Platform API v1.
- **"Always paused" creation.** A2-04: tool descriptions promise always-paused creation that only *policy*
  delivers; with policy altered, creation is not inherently paused.
- **Creative tooling in prompts.** A14-03: engine prompts reference `get_creative_performance` and "creative
  fatigue" that the shipped catalog and data model cannot support.
- **Snapchat metric citation.** A4's capability table cites `platform/packages/snapchat/src/provider.ts:197,320-335`,
  but that file is 172 lines; A16 re-verified the substance (5-field metric map, purchases-only) at
  `provider.ts:139`. Substance holds; the specialist's line numbers do not. Recorded as a citation defect, not
  a capability change.

---

## 7. Confidence and what was NOT verified

**Confidence: 0.82** that this executive picture is faithful to the code. It rests on fifteen specialist
reports (each 0.78–0.86 self-rated, most with passing tests) plus A16's seventeen re-opened citations, all of
which confirmed the substance.

NOT verified by A16 (inherited from the specialists): live ad-platform wire behaviour (no credentials, egress
blocked) — everything about real API responses is VERIFIED_CODE at best, runtime NOT_VERIFIED; live Pipeboard
MCP payload shapes; the running Next.js dashboard (F-11 is static-analysis + code read, not a browser run);
Docker/network paths (sandbox-blocked). The P0 currency and scope-bypass findings are argued from code +
documented platform semantics; a live sandbox would be needed to demonstrate the 100× budget end-to-end.
