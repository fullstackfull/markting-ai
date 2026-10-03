# P0-E Exit — CI, data-trust, live-mode states, config & dependency guardrails

Covers R0-10 (CI), R0-11 (data-trust floor), R0-12 (live-mode states), the self-approval default,
outbound/SSRF posture, the Arabic-report gate, and the Next.js reachability investigation.

## R0-10 — root CI (`.github/workflows/ci.yml`)
Jobs: **node** (install --frozen-lockfile, `pnpm -r typecheck`, package builds, all package tests,
cloud tests DB-off); **cloud-db** (start local Supabase, `migration up` forward-only, run the DB-gated
tenant-isolation / authz / concurrency suites with `ADPORT_RUN_DATABASE_TESTS=1` against a real
Postgres); **engine** (ruff, format --check, mypy, full pytest in a clean workspace, then the
engine-host tests with the kill switch pinned out of tree); **infra** (stripe script test); **drift**
(`scripts/check-upstream-edits.sh` fails on any `engine/` change vs import `4162146`); **security**
(`pnpm audit --prod --audit-level high`, pip-audit advisory, gitleaks). The previously DB-gated suites
now actually run in CI. NOT verifiable in this sandbox (no GitHub Actions runner / no Docker Supabase
here) — the workflow is authored and YAML-validated; first green run must be confirmed on GitHub.

The F1 defect (stray `engine/workspace/KILL_SWITCH` reddening 19 upstream tests) is fixed: `make
test`/`make ci` and the CI engine-host lane pin `PAID_MEDIA_KILL_SWITCH_PATH` outside `engine/`, and
the full engine suite runs in a clean checkout where no stray file exists (verified locally: 177
passed).

## R0-11 — data-trust floor (`lib/markting/data-trust.ts`)
Trust tiers UNVERIFIED < PLATFORM_REPORTED < VALIDATED < RECONCILED, plus SYNTHETIC isolated from live
tiers. `evaluateEvidence` returns `INSUFFICIENT_EVIDENCE` for synthetic data, UNVERIFIED data, an open
(partial) window, or a ratio-based recommendation below the `MIN_SAMPLE_FOR_CONFIDENCE` floor (30).
It deliberately does **not** compute statistical significance — it only enforces that classified
evidence exists before a recommendation is surfaced as actionable. Tested in `test/data-trust.test.ts`.
(Wiring this gate into the live recommendation surface lands with the live-data path in Phase 1; today
all engine data is SYNTHETIC, so every live recommendation would correctly return INSUFFICIENT_EVIDENCE.)

## R0-12 — live-mode safety states (`lib/markting/runtime-mode.ts`)
Closed enum DEMO / LIVE_READ_ONLY / LIVE_RECOMMENDATIONS / LIVE_WRITE_DISABLED /
LIVE_WRITE_APPROVAL_ONLY. There is **no** FULL_AUTONOMOUS_WRITE member — the type cannot express it.
Fresh non-demo deployments default to LIVE_WRITE_DISABLED (fail closed); `assertApplyAllowed()` gates
the dashboard apply route so a live apply is refused (409) unless the operator explicitly sets
LIVE_WRITE_APPROVAL_ONLY, which is itself gated behind the Phase 0 exit. Demo alias binding to a real
account remains impossible through the UI (no writer), preserved as a safety property. Tested in
`test/runtime-mode.test.ts`.

## Self-approval default
Root `.env.example` now ships `MARKTING_ALLOW_SELF_APPROVAL=false` (was true), matching the cloud
template and the code default. Documented that engine proposals are ai_agent-requested, so a human
approving them is never self-approval regardless of the flag. Production: disabled; a single-user demo
may opt in explicitly.

## Outbound / SSRF posture
There is no configurable outbound host allowlist and no n8n/RSS/webhook ingestion in this product
(verified: no such code). The engine's egress is to Pipeboard (only when PIPEBOARD_API_TOKEN is set,
which `assert_fail_closed` forbids in the markting host) and the model provider (live mode only). The
inbound Stripe webhook verifies its signature. There is no SSRF-exposed fetch-by-user-URL surface.
`OUTBOUND_ALLOWED_HOSTS` is therefore **not applicable** to this repo; recorded rather than invented.
If a future internal-webhook/n8n integration is added, it must ship with a default-deny allowlist and
SSRF tests before enablement (release-note placeholder).

## Next.js image-optimization reachability (suspected RCE)
Version `16.3.1` (standalone self-hosted). No `next/og`/`ImageResponse`/`/api/og` anywhere; one
`next/image` usage; `next.config.ts` sets no `images.remotePatterns`, so the built-in `/_next/image`
optimizer is present but can only optimize same-origin images (no arbitrary remote fetch). The route
is reachable but its remote-fetch attack surface is not enabled. **Verdict: production blocker, not a
confirmed live RCE.** Recommended remediation in the deploy pipeline: bump Next to the patched release
line and regenerate the lockfile, then re-run build + e2e. Not bumped here because a framework version
change must be validated with a full build/e2e that this sandbox cannot run, and the deploy repo owns
the lockfile. Evidence recorded; left as a blocker (see PHASE0-EXIT-REPORT Gate E).
