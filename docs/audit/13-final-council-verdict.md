# 13 — Final Council Verdict (MARKTING-AI)

## How to read this

This is the signed verdict of the eight-seat final council that closes the forensic audit of MARKTING-AI (repository at `/home/user/markting-ai`, HEAD `2e68a7f`). It is not new analysis; it is the court of record converting the council memos (`docs/audit/agents/K1`–`K8`), the executive summary (`00`), and the dependency-ordered roadmap (`12`) into an explicit, three-part decision per seat: **GO / NO-GO** on (a) *continued development on this architecture*, (b) *accepting a first paying customer now*, and (c) *enabling live writes to real ad accounts now*. Each seat's paragraph is written in its own voice and carries the evidence its ruling rests on. After the eight seats comes the consolidated council verdict, the exact roadmap conditions under which each NO-GO flips to GO (traced to `R<phase>-NN` item IDs in `12-roadmap.md`), the dissenting opinions preserved verbatim, and the statement on implementation. Before signing, seat K13 independently re-read the five most load-bearing citations in code at HEAD — the engine sample-mode pin, the zero-decimal currency conversion, the adport REST write path, the unscoped reports route, and the dashboard apply route's self-approval guard; **all five held exactly** (see the spot-check ledger at the end). Read this document for the decision; read `01`–`12` and `K1`–`K10` for the reasoning.

### Classification / severity legend

- **VERIFIED_CODE** read directly in source at HEAD. **VERIFIED_TEST** proven by a repo test. **VERIFIED_RUNTIME** reproduced by an agent running the code. **DOCUMENTED_ONLY** asserted by docs/README, not confirmed in code. **INFERRED** reasoned, not directly observed. **NOT_VERIFIED** could not be checked in this sandbox.
- **P0** security / data loss / cross-tenant / unsafe ad execution. **P1** production blocker or serious financial risk. **P2** substantial functional/reliability deficiency. **P3** quality/polish. **GAP** a missing capability the product does not claim (not a defect unless the code claims it).
- The council's standing adjudication on the P0 line: **0 exploitable in the shipped fixture-only demo today**; **6 P0-class defects that activate the instant live data or live writes are switched on** (K4 rules P0=0 today; K1 keeps the zero-decimal currency bug as a latent P0).

---

## The eight seat verdicts

Each seat rules on three independent questions. In shorthand: **(a)** keep building on this codebase and architecture; **(b)** take a paying customer on the product as it stands now; **(c)** turn on writes to real ad accounts now.

### Seat 1 — Head of Paid Media (K1)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

From capabilities alone, re-opening 23 matrix cells across nine providers plus the engine, cloud and demo host (all 23 HELD), MARKTING-AI is a well-guarded approval-and-reporting dashboard with a chat layer whose "AI" never observes the customer's accounts — decisively **not** an intelligent media-buying OS. The architecture is a credible skeleton with a genuine safety spine and is worth continuing to build on (**GO on (a)**), but no capability cell reaches FULL, reporting peaks at READ_ONLY, and the engine-sourced analytic cells (budget pacing, blended ROAS, period comparison) that *look* like PARTIAL live capabilities are **effectively MOCK for real tenant data** because `serve_demo.py` forces `sample` mode in every mode (`services/engine-demo/serve_demo.py` `assert_fail_closed` + `demo_settings`, VERIFIED_CODE). For a paying customer the core value proposition is therefore a demo for four of five personas and read-only partial value for the fifth — **NO-GO on (b)**. On live writes I vouch for one latent P0 that I decline to downgrade: the zero-decimal-currency 100× budget write (K1-05, `meta/src/provider.ts:20` `CENTS_TO_MICROS=10_000` + `lib/markting/translate.ts:107` `Math.round(micros / 10_000)`, VERIFIED_CODE), blind to the percentage cap because the cap compares micros-to-micros. Turning on live writes before that and the working write loop exist would risk a 100× live over-spend in exactly the Gulf/JPY/KRW markets the product targets — **NO-GO on (c)**. Finding tally I vouch for: P0=1, P1=6, P2=1, P3=0, GAP=5. Confidence 0.86; residual is live/runtime behaviour I could not exercise. — *Head of Paid Media, K1*

### Seat 2 — Chief AI Architect (K2)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

The AI layer is a dashboard-with-chat over synthetic data, not an intelligent operating system — CONFIRMED from code at HEAD. What is genuinely real and strong is worth building on: a fail-closed `ProposalOnlyWriteProvider`, an empty approver set, a kill switch checked even for fakes, signed single-use claims with reconciling readback, a deny-by-default engine tool catalog, and a test-verified model-output→adport boundary. I ratify the five-layer target architecture (AI Gateway, tenant-scoped Intelligence Layer, human-confirmed Marketing Memory, a single human-gated/metered/observable recommendation pipeline, and an outcome loop) in a safety-first sequence — **GO on (a)**. But in the default demo mode the "AI" is a keyword regex choosing one of two canned scripts whose recommendation is always a hard-coded `g-103→240`, the model receives only `{text}` with zero tenant/business/locale context, and there is no durable memory, outcome loop, metering, or observability — a product that cannot deliver its advertised intelligence to a paying customer (**NO-GO on (b)**). The invariant "AI may only propose" HOLDS on the engine/Assistant path (bypass attempts 1–6 blocked, VERIFIED_CODE/TEST) but is **BROKEN on adport's REST/MCP write surfaces**: any `tools:write` holder validates then applies with no second human (`app/api/v1/tools/[tool]/route.ts:5-13`, VERIFIED_CODE, re-verified at HEAD), and generic `*_api_update/remove` make uncapped status/bid/targeting/destructive changes — so enabling live writes now is **NO-GO on (c)** until R0-02/R0-03/R0-07 close those holes. P0=0, P1=5, P2=7, P3=3. Confidence 0.86. — *Chief AI Architect, K2*

### Seat 3 — Principal Architect (K3)

> **(a) Continued development: GO, conditional on the Phase-0 decisions.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

I validated the system-architecture map edge-by-edge (27 spot-checks, 26 HELD, 1 PARTIAL on a "near-line-for-line copy" wording, 0 FAILED) and endorse it as the authoritative architecture document. The structure is sound enough to continue on — **GO on (a)** — but strictly conditional on making the Phase-0 architecture *decisions* before any dependent implementation: the engine multi-tenant model (R0-08), the two-Postgres system-of-record and forward-only migrations (R0-09), and keeping the fixture-only fail-closed default until the gate lifts (R0-12). For a paying customer the blockers are structural: a two-Postgres split-brain whose only scripted apply path is a **destructive `supabase db reset` on every `make up`** (`Makefile:27,33`), no root CI, and an unscalable single-process engine SPOF (one `caller_ref` for all tenants, one global asyncio lock, a single-file report index) — **NO-GO on (b)**. On live writes I resolve the write-path question against the optimistic reading: the single-write-path invariant is **conditional, not absolute** — true for the engine/bridge/Assistant path, overstated for adport's REST/MCP surfaces which apply a previewed write on the second call with scope enforcement only and no enforced human approver (K3-03, P1). Combined with non-atomic/double apply (reproduced 4× at runtime) and proposals that can route to real accounts via alias binding over fixture-only analysis, live writes are **NO-GO on (c)** until R0-01, R0-02 and R0-08 land. P1=3, P2=6, P3=1, GAP=1. Confidence 0.86. — *Principal Architect, K3*

### Seat 4 — Security Lead (K4)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO (hard).**

I re-adjudicated all six P1 security findings by re-reading the cited code myself; all six HELD at P1, and **no present-day exploitable P0 survives** because the reports IDOR is bounded to synthetic fixtures by the engine sample-pin. The strongest property — the single human-gated write path (invariants 1, 2, 3, 8, 14) — is real and defended in depth, so the security posture is sound enough to keep building on (**GO on (a)**). My independent 15-invariant table is 9 HOLD, 5 PARTIAL, 1 BROKEN (replay, invariant 12). For a paying customer the live P1 surface is disqualifying: the BROKEN replay invariant (SEC-02), the un-isolated engine reports route (SEC-01, `app/api/reports/engine/route.ts:16-24` lists after `sessionPrincipal` but calls `engineClient().listReports()` with the org never passed — VERIFIED_CODE, and J2 had caller B download caller A's report at runtime, VERIFIED_RUNTIME), an unpatched Next.js 16.3.1 with three critical RCE advisories (SEC-04), and no root CI to run any of the isolation suites (SEC-05) — **NO-GO on (b)**. Enabling live writes now is a **hard NO-GO on (c)**: it is precisely the switch that converts every latent P0 into a live one — reports IDOR becomes cross-tenant real-data disclosure, the self-approval guard is absent entirely on the API-key/MCP apply path (SEC-26, `apply/route.ts:22` skips the check for null `createdBy`; `engine.ts:104` `apiPrincipal` has no `userId`), and budget caps are checked only at validate time. Final security-scope counts: P0=0, P1=6, P2=9, P3=13. Two P1-vs-P0 calls remain genuinely open on deployment facts I could not decide from the repo (see dissents). — *Security Lead, K4*

### Seat 5 — Data Scientist (K5)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

The engine's arithmetic over the data it is handed is trustworthy — Decimal-based, None-safe, never averages ratios, hard-errors on intra-read currency mismatch, and test-covered — a genuinely sound numeric core worth building on (**GO on (a)**). But the provenance and trust machinery *around* that arithmetic is fixture-shaped: on the live path every gate meant to say "this number is not settled/reconciled/comparable yet" is off, tautological, or prose-only, so live data would enter at trust tier T1 and be rendered with T3/T4 confidence. I vouch at P2 for partial-conversion/partial-impression ratios emitted as authoritative (up to ~3.5× wrong), a hardcoded/tautological `reconciled` signal, a cross-platform CPA/ROAS blend mixing incompatible attribution with a dead `ATTRIBUTION_DIFFERS` flag (`domain/common.py:64`), no significance/sample-sufficiency engine (a 2→3-conversion day emitted as a signal), and a structurally-0× merchant ROAS tile summing across currencies — a system that would surface unearned confidence to a paying customer making budget decisions (**NO-GO on (b)**). On live writes I carry one P1-latent: the zero-decimal-currency 100× budget write; I declined to downgrade it merely because the demo is USD, and recorded its exact reachability condition (live credentials + non-two-decimal account + an approved write). No surfaced number may legitimately carry a computed confidence today, so **NO-GO on (c)** until the 9-rule data-trust floor exists in code (R0-11) and currency integrity is fixed (R0-04). P0=0, P1=1, P2=9, P3=3. — *Data Scientist, K5*

### Seat 6 — QA Lead (K6)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

The governing instruction for this seat is explicit: **a green suite is not evidence of readiness.** The executed evidence is genuinely strong for translation, the two-step gate as a library, the Snapchat wire, and the proposal-only host in demo mode (reproducible: 308/32 cloud, 41 core, 10 policy-engine, 53 bridge, 7 host, 176 engine-hermetic), which supports continued development (**GO on (a)**). But that green figure exercises what the bridge does with a proposal and **none** of the apply-path authorization (zero route tests), concurrency, report tenant isolation, the engine wire contract at runtime, or any browser/RTL flow; 27 of F8's 62 critical-chain scenarios are MISSING, concentrated in authz, cross-tenant and concurrency, and **no CI runs any audited command** — so "tests pass" cannot stand behind a paying customer (**NO-GO on (b)**). The suite also reproduces two safety defects: the double-apply race (`applyWriteCalls: 2`, four independent runtime runs — P1, with no regression guard in existence) and a stale `KILL_SWITCH` poisoning the engine safety suite (19 red, invisible to `make test` — P2). My verdict on live writes is unambiguous: **do not treat "tests pass" as safe to run real ad spend** until the concurrency and route-authorization suites are added, CI runs them on DB and cross-stack lanes, the P1 is fixed, and a live-mode canary exists — **NO-GO on (c)** (R0-01, R0-02, R0-07, R0-10, R3-02 canary). P0=0, P1=1, P2=6, P3=0. Confidence 0.86. — *QA Lead, K6*

### Seat 7 — Product Lead (K7)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

The Workbench information architecture is the right north star and maps to real engine capabilities, and the Arabic chrome is production-grade (RTL, plurals, Latin digits) — a sound base to keep building on (**GO on (a)**), provided it is sequenced *after* the tenant-data path and a working write loop. But no persona reaches WORKS: the keystone is that the AI never analyses the tenant's accounts in either mode (`serve_demo.py` pins data to sample fixtures in demo *and* live, `assert_fail_closed`), so the core value is a demo for all five personas and read-only partial value for the small advertiser. Onboarding is a sound mechanism but mis-targeted (its terminal step wires an MCP client instead of the built-in Assistant) and engineers an immediate activation failure (the Free plan strips `tools:write`, so the preview onboarding promises returns a raw 403); the product also sells capabilities that do not exist (`clientWorkspaces` billed on live checkout with a single dead reader), names an upstream third party as data controller, and the AI's own analysis/proposals/reports are English. These are first-customer blockers — **NO-GO on (b)**. On live writes, the write loop is not merely gated but *absent* — no UI writes `markting_account_aliases`, so a proposal is orphaned/`unsupported` in production — plus a functional UTC approval-expiry defect misread by the Riyadh offset; **NO-GO on (c)** until R4-01 (working write loop), R6-03 and R6-04 land. 20 vouched findings: 0 P0, 7 P1, 7 P2, 4 P3, 2 GAP. Confidence 0.84. — *Product Lead, K7*

### Seat 8 — SRE Lead (K8)

> **(a) Continued development: GO.** **(b) First paying customer: NO-GO.** **(c) Live writes now: NO-GO.**

One framing fact governs this seat: the shipped artifact is a **local, proposal-only demo**, not a product — `docker-compose.yml:41-48` runs `serve_demo.py` with `PAID_MEDIA_WRITES_ENABLED: "false"` and `PAID_MEDIA_DATA_MODE: sample`, Supabase is deliberately outside compose, and the edge is plain `127.0.0.1:3000` HTTP. The demo stack is internally honest and fail-closed, and the architecture is developable — **GO on (a)**. But "accepting a paying customer" means standing up a production topology (hosted Supabase, TLS edge, real Stripe, real OAuth, live model mode) **that does not exist in the repo and could not be built or run here.** I vouch for nine P1 blockers before a first paying customer: no backup/restore (B1), a master encryption key with no KMS/escrow and broken rotation (B2), no usage metering of the dominant AI cost (B3), inability to contract under the operating entity's own name (B4), only destructive `supabase db reset` as a migration path (B5), no TLS edge (B6), no root CI so the tenant-isolation DB suite never runs (B7), no graceful shutdown/drain (B8), and non-cluster-safe shared state (B9). That is a decisive **NO-GO on (b)** — the blocker list is as much a build-list as a fix-list. For live writes, the actual ad-platform apply step is the least observable in the system (no audit row, no metric, no structured log), and you cannot safely move real ad spend you cannot observe, meter, or reconstruct — **NO-GO on (c)** until R1-01/R1-02/R1-06 and the Phase-0 safety gate are met. The P1s are **acknowledged gaps, not hidden defects** — to the project's credit — but each gates money and tenant ad-budgets. P1=9, P2=11, P3≈10. — *SRE Lead, K8*

---

## Consolidated council verdict

The eight seats are unanimous on all three questions. Rendered as the council's binding ruling:

| Decision | Verdict | Vote | Basis |
|---|---|---|---|
| **(a) Continued development on this architecture** | **GO** | 8–0 (K3 conditional) | The safety spine is real and test-verified; the five-layer target architecture (K2) and the Workbench IA (K7) are ratified; the numeric core (K5) and the architecture map (K3) are sound. The one condition, from K3, is that the Phase-0 *architecture decisions* (R0-08, R0-09, R0-12) be made before any implementation that depends on them. |
| **(b) Accepting a first paying customer now** | **NO-GO** | 8–0 | The core value — an AI that observes and acts on the customer's own accounts — does not exist in either mode (unanimous across K1/K2/K7, VERIFIED_CODE). Layered on top: nine production-infrastructure P1 blockers (K8), six security P1s with no exploitable P0 only because of the fixture pin (K4), no CI and 27 missing critical-chain test scenarios (K6), data rendered above its earned trust tier (K5), and sold-but-absent features plus an immediate onboarding activation failure (K7). The production topology these blockers describe does not exist in the repo. |
| **(c) Enabling live writes to real ad accounts now** | **NO-GO (hardest line)** | 8–0 | This is the switch that converts every latent P0 into a live one. The write invariant is broken on adport's REST/MCP surfaces (K2, K3), apply is non-atomic/replayable (K3, K4, K6), the self-approval guard is absent on the API-key/MCP path (K4), budget caps are bypassable at apply (K4, K5), object-ownership is unasserted on typed Meta writes (K4), the zero-decimal-currency 100× write is live-reachable (K1, K5), there is no working alias→real-account write loop (K7), and the apply step is unobservable (K8). No seat will sign off on live writes before Phase 0 exits. |

**The single sentence the council stands behind:** MARKTING-AI today is an honest, well-guarded, proposal-only *demo of a safety architecture* operating entirely over three USD synthetic fixtures — a sound skeleton worth building into the product it describes, but not that product yet, and not safe to point at a customer's money until Phase 0 is complete.

---

## Conditions under which each NO-GO becomes GO (traced to roadmap IDs)

The roadmap (`12-roadmap.md`) is dependency-ordered into Phases 0–7. The council maps each NO-GO to the specific items that flip it.

### (b) First paying customer — NO-GO → GO requires:

- **Phase 0 exited in full** — the gate every other phase sits on: atomic/idempotent apply (**R0-01**), human approval + requester≠approver on all write surfaces (**R0-02**), capped/retired generic API tools with the risk classifier mirrored on the adport path (**R0-03**), currency-unit integrity (**R0-04**), object-ownership assertion on typed writes (**R0-05**), apply-time cap re-check (**R0-06**), per-org isolation of report index/files/conversation prose (**R0-07**), the engine multi-tenant decision (**R0-08**), two-Postgres resolution + forward-only migrations (**R0-09**), root CI with the authz/concurrency/DB suites and drift check (**R0-10**), the 9-rule data-trust floor in code (**R0-11**), and the kept fixture-only gate with audited alias binding (**R0-12**).
- **Phase 1 production hardening** — the nine K8 blockers: backup/restore (**R1-01**), KMS/escrow + rotation (**R1-02**), TLS edge (**R1-03**), graceful shutdown/drain (**R1-04**), cluster-safe report index + kill switch (**R1-05**), observability floor incl. an audited apply step (**R1-06**), supply-chain/container hardening incl. the Next.js RCE patch (**R1-07**), an async job model for chat/report runs (**R1-08**), retention/deletion across markting + engine memory (**R1-09**), and Stripe webhook ordering/lifecycle (**R1-10**).
- **The core value made real** — tenant context to the model (**R3-01**), the live tenant-data read path (**R3-02**, which lifts the fixture pin only behind the Phase-0 gate), and at least a working proposal→approval→apply loop (**R4-01**).
- **Product honesty and legal** — honest plan disclosure, own legal entity, de-branding, and the UX correctness fixes (ROAS tile, Remove-member, onboarding→Assistant, preview availability, Arabic approval-expiry) (**R6-03**, **R6-04**).

### (c) Live writes to real ad accounts — NO-GO → GO requires (a strict subset that must land *before* any live write, even for a single tenant):

- **R0-01** atomic/idempotent apply (closes double-apply + the BROKEN replay invariant).
- **R0-02** human approval + requester≠approver on dashboard **and** REST **and** MCP surfaces.
- **R0-03** cap or retire the generic `*_api_update/remove` tools; mirror the engine risk classifier on the adport write path.
- **R0-04** currency-unit integrity for zero- and three-decimal currencies (closes the latent-P0 100× write).
- **R0-05** object-ownership assertion on typed writes.
- **R0-06** budget/delta cap re-check at apply time.
- **R0-07** per-org isolation before any live report/prose data exists.
- **R1-06** an observable, audited apply step.
- **R0-12 → R3-02** the explicit, signed go/no-go that lifts the fixture-only gate, plus a live-mode canary (**R4-01** working alias binding, K6's canary requirement).

### (a) Continued development — already GO, with one condition:

- Make the Phase-0 **product decisions** — engine multi-tenant model (**R0-08**), two-Postgres system-of-record (**R0-09**), and keep the fail-closed fixture default (**R0-12**) — before building the dependent layers (R3/R5/R7). Development that does not touch a live account, a live model, or a second tenant may proceed immediately.

---

## Dissenting opinions (preserved verbatim)

The council resolved almost every tension from code. The following are preserved because they are either genuinely unresolved on facts not decidable from the repo, or a seat declined to join the consensus severity. They are reproduced verbatim from the council memos.

**1. Cross-tenant prose/report leak — P0 (C5) vs P1 (C14), adjudicated P1-now/P0-live (K2).** C5 rated the summarization / `/conversation_history` cross-tenant exposure **P0 "by construction, latent in default config"**; C14 keeps it P1. K2's verbatim ruling (`agents/K2.md`): *"I rate the consolidated isolation finding P1 today, P0 the moment live per-org reads are enabled. C5's 'by construction' is mechanically correct and I preserve it; C14's severity [discipline is right that ad-data confidentiality is not breached while every org sees identical] fixtures. The one place I lean toward C5 is the `/conversation_history` sub-path: it writes a [tenant's own verbatim prompts readable by other threads on a shared process … a] genuine P1 now, not merely latent."* The owner must confirm whether live per-org reads will share one engine process.

**2. Zero-decimal currency 100× write — P0 (K1) vs P1-latent (K2/K4/K5).** K1 declined to downgrade its single P0, verbatim (`agents/K1.md`): *"Zero-decimal currency (JPY/KRW…) produces a 100× budget via a hard-coded 2-decimal minor-unit assumption; the pct cap compares micros-to-micros so it is blind to it. Latent (live-write path only; fixtures are USD)."* K5 concurs on the mechanism but tags it P1-latent, verbatim: *"declined to downgrade to P2 merely because the demo is USD, but recorded the reachability condition (live credentials + non-2-decimal account + approved write) so it is not treated as an exploited-today defect."* The register carries it as P0-raw / P1-adjudicated-latent; both readings are preserved. No seat disputes the code (VERIFIED_CODE at `translate.ts:107`, `meta/src/provider.ts:20`).

**3. SEC-04 Next.js RCE — P1 vs P0 (UNRESOLVED).** K4 verbatim (`agents/K4.md`): *"SEC-04 P1 vs P0 turns on whether Next.js image-optimization / `next/og` is reachable from any route … [E9 said] 'escalates to P0 if reachable'; no agent proved reachability. Open — NOT_VERIFIED."* Owner must trace route reachability in the deployed app.

**4. SEC-01 reports IDOR — P1 vs P0 (UNRESOLVED).** K4 verbatim: *"SEC-01 P1 vs P0 turns on production topology (multi-org on one engine + a real-data report host)."* Not decidable from the repo; `docker-compose` shows a single engine consistent with the risk but not proof of multi-org production use. Owner must declare the multi-tenant engine topology (R0-08).

**5. Write-path invariant framing — "model-proof by construction" (E6) vs "P1 autonomous-write holes" (C7/C13), resolved by scope (K2/K3).** K2 verbatim: the invariant *"HOLDS on the engine/Assistant path (attempts 1-6 blocked) but is BROKEN on adport's autonomous REST/MCP write surfaces."* K3 resolved the map's §12 "structurally present and fail-closed" wording **in favour of K2**: the invariant is **conditional** (K3-03, P1). Preserved because the two framings read as a contradiction unless scoped: the *model-driven* invariant is not broken; the *product-level* invariant is.

**6. A self-approval env default diverges across two `.env` templates (K4, PARTIAL on 2 of 24 spot-checks).** A configuration decision, not a defect; the owner should pick one default. Preserved as a lower-stakes open item.

No other contradictions were left genuinely unresolved; K9 recorded zero unresolved contradictions in the red-team cluster, and K10's register makes the raw-vs-deduplicated P0 count (6 raw / 0–1 adjudicated-live) explicit rather than silently reconciling it.

---

## Statement on implementation

**No implementation, refactor, fix, or deletion was performed during this audit by any seat, including this final-council seat.** This was a strictly read-only, static examination of the repository at HEAD `2e68a7f`. The only files written are the audit deliverables under `docs/audit/` (this document, `docs/audit/13-final-council-verdict.md`, among them). No source file outside `docs/audit/` was modified, and no git state was changed. Every verdict above describes what the code *is* and *does when invoked in-process*; the council could not and did not build or run the production stack, live model, live credentials, real Supabase, or a second-tenant deployment — the precise conditions under which the six latent P0-class defects activate. Those remain **NOT_VERIFIED by construction** and are themselves a production gate (see `00` §"Exactly what was NOT verified"). The roadmap sequences the work; it does not perform it.

---

### Seat K13 spot-check ledger (re-verified in code at HEAD `2e68a7f`)

| # | Citation | Claim | Verdict |
|---|---|---|---|
| 1 | `services/engine-demo/serve_demo.py` `assert_fail_closed` (data_mode must be `sample`, approver set empty, kill switch engaged) + `demo_settings` | Engine refuses to start unless pinned to fixtures in both modes | **HELD** (VERIFIED_CODE) |
| 2 | `platform/apps/cloud/lib/markting/translate.ts:107` `meta_set_budget … Math.round(micros / 10_000)` | Hard-coded 2-decimal conversion → 100× for zero-decimal currencies | **HELD** (VERIFIED_CODE) |
| 3 | `platform/apps/cloud/app/api/v1/tools/[tool]/route.ts:5-13` | REST applies a write after only `requireScope`; no human approver | **HELD** (VERIFIED_CODE) |
| 4 | `platform/apps/cloud/app/api/reports/engine/route.ts:16-24` | GET authenticates a session then calls `engineClient().listReports()` with the org never passed | **HELD** (VERIFIED_CODE) |
| 5 | `platform/apps/cloud/app/api/approvals/[id]/apply/route.ts:22` | Self-approval guard `row.createdBy && row.createdBy === principal.userId && …` skips entirely when `createdBy` is null | **HELD** (VERIFIED_CODE) |

*Final council verdict signed by seat K13. Sources: `docs/audit/00-executive-summary.md`, `docs/audit/12-roadmap.md`, council memos `docs/audit/agents/K1`–`K8` (K9/K10 context). Five load-bearing citations independently re-verified in code at HEAD `2e68a7f`; all five held exactly.*
