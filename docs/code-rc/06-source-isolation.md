# 06 — Source isolation & demo-path audit (Programs 20–21)

## Source isolation hardening (Program 20)
Two layers now keep fixture/sandbox data out of a live surface and vice-versa:
1. **Structural (pre-existing):** `serviceForMode()` wires the DEMO runtime to the clearly-synthetic
   demo gatherer and any live runtime to the `emptyGatherer` (truthful NOT_CONNECTED). A live deployment
   never reads the demo seed.
2. **Defense-in-depth (new):** the intelligence loaders (`lib/cloud/intelligence.ts`) run every composed
   answer through `assertResultPostureAllowed(mode, tier)` before it reaches a surface — a live
   deployment FAILS CLOSED on a `SYNTHETIC` (demo-seed) result; a DEMO deployment fails closed on a
   live tier. The neutral `UNVERIFIED` empty state is allowed in either posture. Tested through the
   loader-facing `source-isolation.test.ts`, and the record-level `classifySource` /
   `assertNoMixedSources` guards still fail closed on ambiguity or a live+fixture mix.

## Demo-path audit (Program 21)
A repo-wide audit classified every fixture/demo/sandbox fallback:
- `demoGatherer` and the demo seed — selected ONLY when `isDemoMode()`; otherwise `emptyGatherer`.
- `loadCampaign` / `loadCampaignList` / `loadCreativeDetail` — each returns a NOT_CONNECTED state when
  `!isDemoMode()` (no demo content leaks in live).
- `lib/cloud/runtime.ts` — explicitly 403s a retired demo workspace in a live deployment.
- `lib/markting/data-trust.ts` — synthetic data is refused as live evidence (`INSUFFICIENT_EVIDENCE`).

**Classification result:** every demo/fixture path is `TEST_ONLY` or `DEMO_ONLY` (gated by
`isDemoMode()` / runtime mode). **No `PRODUCTION_REACHABLE` demo fallback was found.** Gate "no critical
hidden demo path": GREEN.

## E2E posture note
The authenticated browser E2E runs the server in DEMO runtime with a real seeded Supabase session (so
auth resolves and surfaces have synthetic content). This is consistent with the guard above — SYNTHETIC
is permitted in DEMO — and the `test-login` route that enables it is a hard 404 unless the explicit
`MARKTING_E2E_TEST_AUTH` flag is set (never in production).
