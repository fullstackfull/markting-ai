# 08 — End-to-End Intelligence Customer Flow (Stage 11)

The intelligence journey (create org → invite user → connect provider → connect commerce → configure
business context → configure targets → synchronize → ask AI → morning brief → creative intelligence →
profitability analysis → recommendation → experiment/scenario analysis) is built end-to-end. Each code
step is exercised by the phase suites against FIXTURES/sandbox + the deterministic engines
(FIXTURE_PROVEN/SANDBOX_PROVEN). The two steps that require live externals — connect provider (OAuth)
and connect commerce — are BLOCKED_EXTERNAL; every other step runs on real logic:

- org/users/targets/business-context: Phase-0/1 + cloud auth/repository (code-proven).
- synchronize: Phase-5 sync engine (bounded, idempotent, checkpointed) on fixtures.
- ask AI / morning brief: Phase-1/3 narration over governed data with local fallback.
- creative intelligence: Phase-4 (analysis-only).
- profitability: Phase-5 (merchant truth vs platform; PII-safe).
- recommendation + experiment/scenario: Phase-2/6 (review-only, deterministic).

Result: the READ/intelligence journey is READY on the code path; the live provider/commerce legs are
HELD on credentials. This is exactly Launch Mode A (intelligence-only).
