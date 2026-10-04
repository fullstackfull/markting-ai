# 19 — Prioritized Roadmap (ICE·R / dependency-ordered)

Scoring: Impact (1–5), Confidence (1–5), Reach (1–5), Effort (1–5, lower=cheaper), Dependency. Priority
score ≈ (Impact·Confidence·Reach)/Effort, then dependency-sorted. **This is the council's recommendation,
NOT a build order to execute now — the final council is an assessment gate.** We explicitly recommend
NOT building everything; see "What NOT to build".

| # | Item (gap) | I | C | R | E | Dep | Score | Note |
|---|---|---|---|---|---|---|---|---|
| 1 | Live data gatherer: ReportRow→MetricObservation→orchestrator (G-P0-1) | 5 | 5 | 5 | 3 | — | 41 | Unlocks ALL intelligence surfaces on real accounts; engines already exist |
| 2 | Fix Overview blended-conversions tile (G-P0-2) | 4 | 5 | 5 | 1 | — | 100 | Cheapest high-trust fix; stop the one misleading headline number |
| 3 | Apply formatMoney on intel surfaces (G-P1-2) | 4 | 5 | 5 | 1 | — | 100 | Trivial; removes a 100x readability/trust hazard |
| 4 | Compute flagship diagnosis/materiality from data (G-P1-4) | 4 | 4 | 5 | 2 | 1 | 40 | Remove hard-coded demo headline once live data flows |
| 5 | Date-range / time control (yesterday/MTD/custom) (G-P1-3) | 5 | 5 | 5 | 3 | 1 | 41 | Table-stakes for daily use |
| 6 | Tenant audit_events DB-enforced append-only (G-P1-6) | 3 | 5 | 4 | 1 | — | 60 | Cheap security hardening; matches platform_admin_audit |
| 7 | Soften external "AI" positioning OR wire live model (G-P0-3/G-P1-1) | 4 | 4 | 5 | 3 | — | 27 | Positioning now (cheap); live model is BLOCKED_EXTERNAL |
| 8 | Entity/brand/legal cutover to MARKTING-AI (G-P1-8) | 4 | 5 | 4 | 2 | — | 40 | Can't contract/sell under upstream author |
| 9 | Ad-set/ad-group tier + social-native dims (G-P1-5) | 4 | 4 | 4 | 4 | 1 | 16 | Depth; needs live fetch expansion |
| 10 | Commerce live transport + webhook route + sync runner (G-P1-7) | 4 | 3 | 3 | 5 | — | 7 | Profit differentiator; BLOCKED_EXTERNAL + infra |
| 11 | Tenant RLS defense-in-depth backstop (G-P2-1) | 4 | 4 | 5 | 4 | — | 20 | Removes the single-miss cross-tenant risk class |
| 12 | Operator table mechanics: search/sort/paginate (G-P2-6) | 3 | 5 | 4 | 3 | — | 20 | Daily-driver ergonomics |
| 13 | Wire creative engine to surface + asset rendering (G-P2-4) | 3 | 4 | 3 | 4 | 1,9 | 9 | Multimodal model = BLOCKED_EXTERNAL |
| 14 | SSO/SAML/SCIM/MFA (G-P2-2) | 3 | 4 | 3 | 5 | — | 7 | Enterprise procurement gate |
| 15 | KMS/BYOK + AI metering + VAT/SAR billing (G-P2-7/8) | 3 | 4 | 3 | 4 | — | 9 | Enterprise + Gulf monetization |
| 16 | Incrementality/MMM + significance testing; fix CPA forecast (G-P2-3) | 3 | 3 | 3 | 5 | 1 | 5 | Measurement-system credibility |
| 17 | Search depth (search-terms/negatives/IS/PMax) (G-P2-5) | 3 | 3 | 3 | 5 | 1,9 | 5 | De-Meta-centre |

## Recommended sequence (dependency-aware)
**Phase A — make it honest & real on one account (cheap, unlocks everything):** 2, 3, 6, 8, then 1, then 4 & 5.
**Phase B — depth on real data:** 9, 12, 11.
**Phase C — the external-gated bets (only with a design partner + budget):** 7 (live model), 10 (commerce live), 13, 14, 15, 16, 17.

## What MARKTING-AI should NOT build (avoid complexity without value)
- A second connection engine, a second crypto system, or a second admin product (all already canonical).
- Autonomous optimization / Mode-B auto-writes (safety posture is a differentiator; keep human-in-loop).
- More dashboards/surfaces before the live gatherer exists — new surfaces would also render empty.
- A bespoke MMM before there is any live data to model.
- Fabricated "AI" features to match rivals — the honesty discipline is the moat; do not trade it for parity theatre.
