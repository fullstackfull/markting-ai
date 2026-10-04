# MARKTING-AI — Global Maturity Verdict

**Assessment gate. Not a build order.** 16 independent specialist reviewers + a reconciling council,
grounded in the actual code (HEAD at review time `7cc7acf`, re-based `de77255`) and dated public research.

## Verdict
**PROMISING — NOT YET GLOBALLY COMPETITIVE.**
(Dissent recorded: red-team = NO/WOULD_NOT_USE; investor on product merits = PASS. Reconciled: strong
foundations + MENA wedge → *promising*; no live value loop → *not competitive today*.)

## Competitive tier
**TIER 1 — usable internal tool / pre-commercial.** Foundations (safety spine, 11 live adapters, connection
control plane, Arabic/RTL, data-quality honesty) are Tier-3/4-grade; live product value is Tier-0/1.

## Scores (/100)
Overall 38 · Media-buyer 38 · Agency 28 · Ecommerce/profit 42 · Creative 22 · Search 33 · Paid-social 32 ·
AI 25 · Integrations 55 · Enterprise 38 · Security 72 · UX 62 · Global competitiveness 30.

## The decisive fact
There is **no live value loop**: `lib/cloud/intelligence.ts:46` is binary demo/empty; no gatherer feeds real
provider data into the (strong, real) engines. On a live account the flagship surfaces are empty, the AI is
dormant, writes are held, and commerce is BLOCKED_EXTERNAL. Exceptional engineering and honesty; near-zero
live product value today.

## Strongest advantages
1. Governed single write path — fail-closed preview → human approval → append-only audit (genuinely distinct).
2. Arabic/RTL-first product (unique across the global comparison set).
3. Radical data-quality honesty (trust tiers, UNKNOWN-gating, no fabricated or blended-currency numbers).
4. Security + platform/tenant plane separation (strong, enforced, tested on real Postgres).
5. A broad, real integration foundation (11 live ad adapters + a canonical connection control plane).

## Weakest areas
Creative (22), AI maturity (25), Agency ops (28), Global competitiveness (30) — all gated by the same missing
live loop + dormant model + held writes; plus no incrementality/MMM and no enterprise SSO/compliance.

## Would a customer switch?
- **Why they would:** Arabic/RTL-first, trustworthy numbers, and a safe governed way to let AI touch accounts
  — *if* the live loop and model existed.
- **Why they would NOT (today):** it shows less than the native platforms on a real account, the "AI" isn't a
  model, it can't change anything (Mode-B held), and live regional incumbents (Boostline, Salla Ads) already
  own the Arabic + Salla/Zid wedge.

## One-track path to change this verdict
Roadmap Phase A: fix the blended-conversions tile + apply money formatting + enforce audit append-only
(all cheap), then build the live `ReportRow→MetricObservation` gatherer and add a time-range control. That
turns the empty cockpit into a real one and would move multiple reviewer verdicts up.

See `18-gap-register.md`, `19-prioritized-roadmap.md`, `17-global-competitive-matrix.md`, `20-final-council.md`.
