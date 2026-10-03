# 04 — Data trust & attribution

## Trust tiers (wired into the real data path)
UNVERIFIED < PLATFORM_REPORTED < VALIDATED < RECONCILED, plus SYNTHETIC isolated from all live tiers.
The tier is supplied by the runtime at normalization time: fixtures → SYNTHETIC, a live provider read
→ PLATFORM_REPORTED. A platform-reported ROAS is explicitly NOT a reconciled merchant ROAS; the tier
travels with every observation and into every aggregate (the aggregate takes the worst tier present).

## Attribution
`AttributionBasis { label, event?, window? }` rides on each observation. `comparePeriods` refuses to
treat mixed-currency aggregates as comparable, and (via the evidence floor) flags incompatible or
unknown bases. The engine's platform-reported conversion value is never treated as business truth;
the merchant-reconciled path is the commerce connector (see 1Q / future).

## INSUFFICIENT_EVIDENCE (deterministic gates)
`evaluateEvidence` + the analysis engine return INSUFFICIENT_EVIDENCE when data is SYNTHETIC,
UNVERIFIED, from an open (partial) window, below the sample floor (30 conversions for a ratio-based
conclusion), mixed-currency, or missing currency. A recommendation to scale on 1 conversion / a thin
or stale dataset / an incomplete current day is blocked, not fabricated. Proven by the eval suite
(`ai-eval.test.ts` Q4/Q5/Q9) and `data-trust.test.ts`.
