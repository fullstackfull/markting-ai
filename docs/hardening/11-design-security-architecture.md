# 11 — Design system, security, architecture, dead-code, empty states (Programs 31–37)

## Design-system completion + status semantics (Programs 31–32) — `73f2728`
`components/kit.tsx` formalizes the presentational primitives: `StatusChip`, `TrustBadge`,
`ConfidenceBadge`, `RiskBadge`, `FreshnessBadge`, `MetricCard`, `EvidenceCard`, `InsightCard`,
`RecommendationCard`, `BlockedState`, `EmptyState`, `EntityLink`, `DataTable`, `ChartCard`, `Timeline`,
`FilterBar`, `PageHeader`. Wired into `IntelMeta` and the Governance surface. **One status vocabulary**:
every status renders a text label + a currentColor dot (secondary cue) — identity is never color-alone,
and red/yellow/green is not overloaded (risk never borrows the success color). Tested in `kit.test.tsx`.

## Security hardening + CI security lanes (Programs 33–34) — honest status
Security is enforced primarily in the **test suite** (run by `pnpm test` in the node lane), not a
separate SAST lane:
- `security-headers.test.ts` — CSP (`form-action 'self'`, no `unsafe-eval` in prod, scoped OAuth
  callbacks), `Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy: no-referrer`, popup
  `Cache-Control: private,no-store`.
- `phase2-injection.test.ts` — prompt injection treated as **data**: injected campaign/ad text never
  changes org/action/category; diagnosis is identical for malicious vs. benign names (numbers drive it).
- `phase2-safety.test.ts` — the AI **cannot write**: read-only tool registry refuses non-read tools
  (`WRITE_FORBIDDEN_READ_ONLY`); recommendations carry no endpoint/method/body, only a typed review
  action with `requiresHumanApproval === true`.
- `mcp-plan-denial.test.ts` — entitlement gating without leaking upgrade/checkout URLs.
- RLS tenant isolation — `phase1-rls-fixup.database.test.ts` + `database.integration.test.ts` (Postgres).
- The Phase-1 RLS P0 fix (`20261012000000_phase1_rls_fixup.sql`) is in and CI-green.

**Honest note:** the repository's CI (`platform/.github/workflows/ci.yml`) does **not** have a dedicated
dependency-audit / secret-scanning / SAST job in this branch (dependency hygiene is via Dependabot). The
earlier coherence CI description of a 6-lane pipeline with a security lane reflects a different workflow
file; on this branch security is enforced through the vitest suite. Gate "CI security lanes" is
therefore **PARTIAL** — security is tested and gated by `pnpm test`, but not as an isolated scanning lane.

## Architecture dedup & dead-code audit (Programs 35–36)
- Presentational dedup: ad-hoc status spans are being replaced by the one kit (`IntelMeta`, Governance);
  `Empty` from `components/ui` is the shared empty-state used across ~10 dashboard routes.
- Dead-code audit: **no dead/meaningless routes found** — every `app/dashboard/*/page.tsx` loads real
  data (the thinnest, data-quality/agency/executive, still compose orchestrator sections).
- Soft gap (documented, not fixed): a few surfaces render a section only when `section.kind` matches
  with **no else branch** (data-quality, agency, executive), so a mismatched/absent kind renders an
  empty card instead of an explicit empty state. Candidate follow-up, not a correctness bug.

## Product empty states (Program 37)
Empty states are consistent via the shared `Empty`/`EmptyState` component; the kit adds `BlockedState`
to distinguish **withheld** data (e.g. profit UNKNOWN because COGS is missing) from genuinely empty data
— a distinction the product leans on heavily (never infer what is UNKNOWN).
