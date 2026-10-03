# 08 — Production Readiness: What Blocks the First Paying Customer

**Author:** H7 (SRE lead) · **Date:** 2026-10-03
**Inputs:** agent reports H1 (Docker), H2 (CI/CD), H3 (Observability), H4 (SRE/operability), H5 (DB ops), H6 (Backup/DR), I3 (Billing), I4 (Enterprise packaging). Every claim below was re-derived from code or re-run commands; see "H7 spot-check" column and the `agents/H7.md` companion for verification.

---

## 0. Bottom line

**The system is not ready to accept a first paying customer, and the repository's own documentation says so.** `platform/docs/deployment-model.md:49-58` and `docs/TODO.md:18-22` enumerate the unmet production gates themselves — backups, KMS, monitoring/alerting, CI, legal documents, OAuth verification, tested runbooks. This report confirms those gaps against the code and adds the operability and billing defects the docs do not call out.

Two framing facts shape every judgement here:

1. **The shipped stack is a local, proposal-only demo, not a product.** `docker-compose.yml:41-48` runs `services/engine-demo/serve_demo.py` with `PAID_MEDIA_WRITES_ENABLED: "false"` and `PAID_MEDIA_DATA_MODE: sample`, Supabase is explicitly outside compose (`docker-compose.yml:1-5,23-27`), and the edge is plain `127.0.0.1:3000` HTTP (`docker-compose.yml:28-29`). "Accepting a paying customer" therefore means standing up a **new** production topology (hosted Supabase, TLS edge, real Stripe, real OAuth) that **does not exist in the repo** and could not be built or run in this sandbox.
2. **The cloud "apply" path writes to real ad accounts independently of the proposal-only engine.** `platform/apps/cloud/app/api/approvals/[id]/apply/route.ts:26` calls `applyPending(...)` through the adport provider registry — not the engine. So the demo write-safety (kill switch, `assert_fail_closed`) does **not** cover the money-spending mutation that a production cloud deployment exposes. That path has no audit row, no log, no metric (H3-01, confirmed: `grep -c recordAudit apply/route.ts` → 0).

**Verdict by readiness class:** 7 hard blockers (P1), 11 should-haves (P2), plus a set of P3 hygiene items. None of the P1s is a hidden defect — all are either acknowledged in docs or structurally obvious — but every one must be closed before money and tenant ad-budgets are at stake.

---

## 1. Blockers (must close before the first paying customer)

Each blocker is stated with its strongest evidence citation and classification. "Area" maps to the per-area table in §3.

| # | Blocker | Area | Sev | Class | Evidence |
|---|---------|------|-----|-------|----------|
| B1 | **No backup or restore for any data store.** No `pg_dump`/WAL/PITR/snapshot/export anywhere; the only scheduled DB jobs *delete* data. A lost volume loses all tenant config, encrypted credentials, approvals, and audit history with zero recovery. | Backups | P1 | VERIFIED_CODE + DOCUMENTED_ONLY | `rg -li "pg_dump\|pitr"` → 0 (H7 re-ran, empty); `docker-compose.yml:78-80` plain named volumes; `docs/TODO.md:20`; `platform/docs/deployment-model.md:52,58` lists as unmet gate |
| B2 | **Master encryption key has no KMS/escrow and no working rotation.** A single symmetric key is read from an env var; a DB restore without the exact key renders every `provider_credentials.ciphertext` permanently undecryptable, and rotating the key in place would destroy all ciphertext. | Backups / secrets | P1 | VERIFIED_CODE | `platform/apps/cloud/lib/crypto.ts:5-9` (single env key, H7 confirmed); `repository.ts:162` hardcodes `key_version = 1` (H7 confirmed); `platform/docs/deployment-model.md:44-45` prescribes KMS, code does not implement it |
| B3 | **No usage metering; the dominant variable cost (LLM/engine turns, report runs) is unbilled and uncapped per plan.** Only guard is a flat 120 req/min rate limit, plan-independent. A paying org can consume unbounded engine/model cost on any tier, including Free. | Billing | P1 | VERIFIED_CODE | `grep -rniE "usage_event\|billMeterEvent\|usage_record"` → 0 (H7 re-ran, empty); `lib/cloud/plans.ts:11-44` (no AI/report fields); `lib/cloud/repository.ts:355` (flat limit) |
| B4 | **The business cannot contract under its own name.** Privacy policy, terms, in-app support, and the enterprise CTA all name the upstream third party (Yannick Westermann Labs / adport.dev) as operator and sole contact; no DPA, subprocessor register, or SCCs exist. | Legal/billing readiness | P1 | VERIFIED_CODE / DOCUMENTED_ONLY | `platform/website/privacy.html`, `terms.html` (Adport-branded); `app/dashboard/billing/page.tsx:119` `mailto:yannick@adport.dev`; `lib/i18n/messages/support.ts:10-15`; `platform/docs/deployment-model.md:55` (unmet gate) |
| B5 | **No production migration path; the only documented apply mechanism is the destructive `supabase db reset`.** No forward-only `db push`, no ordering doc, no rollback, no pg_cron promotion step. An operator following the repo's workflow would wipe production. | Migrations | P1 (raised from H5's P2) | VERIFIED_CODE / GAP | `Makefile:25-28` (`supabase db reset`); `platform/docs/cloud-local-development.md:12-16`; `platform/docs/deployment-model.md:58` (runbooks "tested before launch" unmet) |
| B6 | **No TLS edge / reverse proxy.** The stack is localhost HTTP only; no nginx/traefik/caddy. Secure cookies and OAuth redirect flows that assume HTTPS will not work for any non-local deployment — a hard prerequisite to serve a remote customer. | Deploy | P1 (raised from H1's P2) | VERIFIED_CODE / GAP | `docker-compose.yml:28-29` (`127.0.0.1:3000:3000` plain HTTP); no proxy service in any compose file |
| B7 | **No CI at the monorepo root; the tenant-isolation DB suite never runs mechanically.** The six upstream workflows live at `platform/.github/` and `engine/.github/` — paths GitHub never reads for this repo (git root = monorepo root). Nothing runs on push/PR; the `*.database*.test.ts` cross-tenant suites and all net-new glue code have zero automated gate. | CI | P1 | VERIFIED_CODE | H7 re-ran: `ls .github` → absent; `git rev-parse --show-toplevel` → `/home/user/markting-ai`; `find -type d -name workflows` → only `platform/`, `engine/` subdirs; `markting-repository.database.test.ts:13` env-gated |

**Borderline-blocker operability defects** (P1 in the specialist reports; blockers the moment the engine runs in `live` write mode or scales beyond one replica — see §2):

| # | Defect | Area | Sev | Evidence |
|---|--------|------|-----|----------|
| B8 | **No graceful shutdown / connection draining.** No FastAPI `lifespan`, no `timeout_graceful_shutdown`; pools' `close()` is defined but never called. SIGTERM either stalls on a 300s in-flight run or SIGKILLs it, aborting work and leaking DB connections — no safe zero-downtime deploy. | Rollout/rollback | P1 | H7 confirmed: `grep "timeout_graceful_shutdown\|lifespan\|SIGTERM" serve_demo.py cli.py` → empty; `serve_demo.py:411-417`; `postgres.py:64` close() uncalled |
| B9 | **Shared mutable state is not cluster-safe.** The report index is one global JSON file capped at 50 entries for *all* tenants (`serve_demo.py:62,302-306`, H7 confirmed), and the kill switch is a per-process local file (`writes.py:195-196`, H7 confirmed). Two engine replicas corrupt the index and cannot share the emergency brake. | Rollout / health | P1 | VERIFIED_CODE (defect); conditional on multi-replica / live-write deployment |

---

## 2. Should-haves (serious, close before scale or before enabling live writes)

| # | Item | Area | Sev | Class | Evidence |
|---|------|------|-----|-------|----------|
| S1 | **The money-spending "apply" produces no audit event, log, or metric; failures silently leave the row `pending`.** The reject path audits; apply does not. | Logs / alerts | P2 | VERIFIED_CODE | `apply/route.ts:26-28` (H7: `recordAudit` count 0); contrast `reject/route.ts:17` |
| S2 | **No metrics anywhere** — no request rate/latency/error, no engine run count/duration, and (for an LLM product) no token or cost metric. | Metrics | P2 | VERIFIED_CODE | H7 re-ran tree grep for prometheus/otel/statsd/datadog → 0; no dep in `package.json`/`pyproject.toml` |
| S3 | **No alerting** on apply-failure rate, `/health` down, cost anomalies, or 5xx spikes. | Alerts | P2 | VERIFIED_CODE | tree grep pagerduty/notify-on-failure → 0 |
| S4 | **No distributed tracing; LangSmith "tracing" documented but not actually enabled** (no `LANGCHAIN_TRACING_V2`/`LANGSMITH_TRACING` flag), and the cloud→engine apply path is untraced regardless. | Traces | P2 | DOCUMENTED_ONLY / INFERRED | `docs/ARCHITECTURE.md:776`, `engine/.env.example:31`; grep for tracing flag → 0 |
| S5 | **Unstructured plaintext engine logs with no org/thread/trace ids; cloud logging inconsistent and context-free.** No request access log on either runtime. | Logs | P2 | VERIFIED_CODE | `cli.py:23-26` basicConfig; 9 cloud `console.*` sites, half JSON half free-form; no `middleware.ts` |
| S6 | **Health endpoint is liveness masquerading as readiness** — never pings Postgres or the model, yet `cloud.depends_on.engine: service_healthy` treats it as readiness; cloud service has **no** healthcheck at all. | Health | P2 | VERIFIED_CODE | `api/app.py:80-89`; H7 confirmed compose healthchecks only at `:56` (engine), `:73` (engine-db) |
| S7 | **markting_* bridge tables are excluded from the retention job (unbounded JSONB growth of per-tenant provenance), and the engine Postgres has no retention at all.** The documented `data_retention_days` guarantee silently does not apply to them. | DB | P2 | VERIFIED_CODE | H7 confirmed: retention fn has 0 `markting` refs (`20260828120000_...`); bridge migration `20261002000000_...` never touches `apply_data_retention()`; engine `postgres.py:11-43` no TTL |
| S8 | **Cloud pool `max:10` with the direct (non-pooler) DB URL is unsafe on the supported serverless (Vercel) target**; no `statement_timeout`/`idle_in_transaction_session_timeout` on any client or role. | DB | P2 | VERIFIED_CODE / INFERRED | `lib/db.ts:7-18`; `.env.example:8` direct port; `next.config.ts:25` Vercel target |
| S9 | **Webhook idempotency is not atomic with its effect and has no ordering/recency guard**; past_due keeps full paid access and there is no `invoice.payment_failed` dunning. | Billing | P2 | VERIFIED_CODE | `billing.ts:119-138` (dedup outside txn), `:57-89` (unconditional overwrite), `:126-131` (no payment_failed), `plans.ts:77` |
| S10 | **No server-side request timeout and a process-wide report lock** → a single slow report (WeasyPrint) blocks the report surface for all tenants; client aborts leave orphaned engine work. | Rollout / health | P2 | VERIFIED_CODE | `serve_demo.py:324,344-353`; engine has no `asyncio.wait_for` |
| S11 | **No Docker image build or root-level secret scan in any pipeline; gitleaks is engine-subtree-only and orphaned.** | CI / secrets scanning | P2 | VERIFIED_CODE | H7 confirmed: `find -iname '*gitleaks*'` → only `engine/.gitleaks.toml`; no root scan; three Dockerfiles built by no workflow |

**Additional should-haves rolled up:** churned customers locked out of re-subscribing (I3-02, P2); no audit export, UI capped at 150 events despite selling 3650-day retention (I4-04, P2); enterprise SSO/SCIM/residency sold but unimplemented (I4-02/05/06, P2 — relevant only if selling enterprise); in-memory fallback loses durable state when `DATABASE_URL` unset (H4-10, P2).

---

## 3. Per-area readiness matrix

Legend: **BLOCKER** (close before first paying customer) · **SHOULD** (close before scale / live writes) · **OK** (adequate for launch) · classification per the audit's tag set.

| Area | Status | Finding | Evidence | Classification |
|------|--------|---------|----------|----------------|
| **Deploy** | BLOCKER | No TLS/reverse proxy (B6); Supabase outside compose so `docker compose up` is not a working system (H1-07); cloud build context has no `.dockerignore`, a gitignored `.env.local` and 577 MB `node_modules` enter the build (H1-01); engine runs as root (H1-02); no resource limits/`stop_grace`/`start_period` (H1-09/H4-07). | `docker-compose.yml:1-5,23-29`; no `platform/.dockerignore`; H7 confirmed `engine/Dockerfile` has no `USER` (only `infra/cloud.Dockerfile:22`); compose grep for limits → empty | VERIFIED_CODE |
| **Database** | SHOULD | Two-instance separation is clean and growth indexes exist (OK), but markting_* + engine DB have no retention (S7), serverless pool math unsafe (S8), no statement/idle timeouts, engine opens 2 pools (up to 8 conns)/process undocumented (H5-06). | `docker-compose.yml:12-78`; `lib/db.ts:7-18`; `postgres.py:50-52` + `self_hosted.py:52-59` | VERIFIED_CODE |
| **Migrations** | BLOCKER | Only destructive `supabase db reset` documented; no forward-only prod path, ordering, rollback, or pg_cron promotion (B5). Engine schema is `CREATE … IF NOT EXISTS` at every boot — no ALTER path, multi-replica race, no version table (H5-05/H4-09). | `Makefile:25-28`; `postgres.py:59-62`; `self_hosted.py:60-61` | VERIFIED_CODE / GAP |
| **Backups / DR** | BLOCKER | No backup/restore/PITR for cloud DB, engine DB, or workspace (B1); key has no escrow/KMS and rotation would destroy ciphertext (B2); the only scheduled jobs delete data (H6-04); no RPO/RTO, no restore drill (H6-06). | `rg pg_dump` → 0; `crypto.ts:5-9`; `repository.ts:162`; `deployment-model.md:52,58` | VERIFIED_CODE + DOCUMENTED_ONLY |
| **Health** | SHOULD | Engine `/health` is static liveness treated as readiness; cloud service has no healthcheck; `/markting/info` is unauthenticated and leaks approver ids + aliases (H3-04, P2). No `/ready`. | `api/app.py:80-89`; `serve_demo.py:326-337`; compose healthchecks only engine+engine-db | VERIFIED_CODE |
| **Logs** | SHOULD | Unstructured, no org/thread/trace ids; apply path unlogged (S1/S5); cloud redaction narrower than engine's and `http.ts:29` logs raw errors with none (H3-05). | `cli.py:23-26`; `reads.ts:19-24`; `http.ts:29` | VERIFIED_CODE |
| **Metrics** | SHOULD (BLOCKER for ops visibility of spend) | None. No request/engine/token/cost metrics anywhere (S2). SLOs are unmeasurable until this is addressed. | H7 tree grep → 0; no metrics dep | VERIFIED_CODE |
| **Traces** | SHOULD | None first-party; LangSmith tracing documented but not enabled; write path untraced (S4). | `docs/ARCHITECTURE.md:776`; grep tracing flag → 0 | DOCUMENTED_NOT_IMPLEMENTED |
| **Alerts** | SHOULD | None (S3). No page on apply-failure, health-down, cost anomaly, or 5xx. | tree grep → 0 | VERIFIED_CODE |
| **CI** | BLOCKER | No root CI; tenant-isolation DB suite and all glue code ungated (B7); upstream workflows orphaned and cited by docs as if live (H2-02). | H7 confirmed `ls .github` absent; `git rev-parse --show-toplevel`; `database.test.ts:13` | VERIFIED_CODE |
| **Dependency / secrets scanning** | SHOULD | Dependabot configs at subdir paths GitHub won't read from root; gitleaks engine-only and orphaned; no root-history scan; no SBOM; base images tag- not digest-pinned (H1-03). | H7 confirmed `find gitleaks` → engine only; `platform/.github/dependabot.yml` at subdir | VERIFIED_CODE |
| **Rollout / rollback** | BLOCKER | No graceful shutdown/drain (B8); no zero-downtime/blue-green; rollback is image-only and additive-DDL-only with unguarded langgraph checkpointer schema (H4-09); no server-side timeout, process-wide report lock (S10). | `serve_demo.py:411-417`; `postgres.py:64`; H7 grep shutdown → empty | VERIFIED_CODE |
| **Billing readiness** | BLOCKER | Stripe Checkout/portal/entitlement are strong (OK), but no usage metering of the core AI cost (B3), no dunning, non-atomic/unordered webhook (S9), churn lock-out (I3-02), enterprise tier has no provisioning path (I4-01), demo seed grants paid plan by direct DB write with no env guard (I3-06). | `plans.ts:11-44`; `billing.ts:119-138`; `seed-demo.mjs:44`; `actions.ts:19` | VERIFIED_CODE |

---

## 4. What was NOT verified in this sandbox

These are genuine unknowns, not passing grades. They must be closed by a networked CI runner and a staging environment before launch.

- **Docker image builds (`cloud`, `engine`, `sandbox`).** Network-blocked by the sandbox (`deb.debian.org` / registry pulls); per task rules, not retried. Whether any Dockerfile builds, whether `pnpm --filter @adport/cloud build:standalone` and `uv sync --extra …` succeed inside the images, and whether `next build` traces `.env.local` into `.next/standalone` (the secret-leak reach in H1-01) are all **NOT_VERIFIED**. `docs/TODO.md:21` records the same limitation.
- **`docker compose up` / live stack runtime.** `docker compose config` validates only with a supplied root `.env` (H1); no container was ever started. Graceful-shutdown behaviour on SIGTERM with a 300s in-flight request, real event-loop blocking from sync psycopg calls, healthcheck timing, and OOM footprint of WeasyPrint are **INFERRED from code, NOT measured**.
- **Live Stripe.** No webhook was exercised end-to-end (no live keys/signatures). The downscaling/canceled transition is VERIFIED_CODE and has an integration test, but `database.integration.test.ts` needs a live Supabase DB and was **not run**. The concurrent-webhook double-processing race (S9) is a code-path inference.
- **Live OAuth (Google/Meta/TikTok/Microsoft/…).** No provider app approval, redirect URIs, or token exchange tested. `platform/docs/deployment-model.md:49-58` lists OAuth verification evidence (scope match, review video, reviewer credentials) as an explicit unmet gate. The Apple Ads ES256 delegated flow and refresh-token handling are **NOT_VERIFIED** at runtime.
- **Managed-Supabase platform backups / PITR / pg_cron.** Whether a production Supabase project would enable daily backups + PITR and actually run the two cron jobs (`adport-data-retention`, `adport-account-selection-expiry`) is an out-of-repo managed-service setting — **NOT_VERIFIED**; the repo configures none of it.
- **Hosted config overrides.** The committed `config.toml` disables MFA/TOTP and pins region `us`; whether the production project overrides these (MFA, residency) is **DOCUMENTED_ONLY** from the repo.
- **pnpm/corepack in this sandbox.** `pnpm --version` fails offline (corepack fetching an uncached pnpm 12.8.1), so the cloud vitest/typecheck/build suites could **not** be executed here (H2-08); only the `uv`/Python half is runnable.

---

## 5. Minimum path to the first paying customer (ordered)

1. **Stand up real infrastructure:** hosted Supabase (with platform backups + PITR enabled), a TLS edge (B6), KMS-held `ADPORT_CLOUD_ENCRYPTION_KEY` (B2), and a forward-only migration runbook that forbids `db reset` in prod (B5).
2. **Make the business legal:** markting-ai legal entity, privacy/terms/DPA/subprocessor register under its own name, and support routing off the single upstream inbox (B4).
3. **Protect margin and money:** add a `usage_events` ledger + per-plan AI/report quotas (B3); audit + log + metric every apply, success and failure (S1); atomic, ordered webhook processing and a dunning policy (S9).
4. **Make deploys safe:** graceful shutdown with a bounded drain (B8); split liveness/readiness and add a cloud healthcheck (S6); externalise the report index and kill switch before any second replica (B9).
5. **Add the gate:** a single root CI pipeline running `make test` + the upstream suites + the tenant-isolation DB suite against a Postgres service, plus a repo-wide gitleaks scan and image builds on a networked runner (B7, S11).
6. **See production:** structured logs with org/trace ids, request/engine/token-cost metrics, and alerting on apply-failure and health-down (S2/S3/S5).
7. **Before enabling any live ad write:** make the kill switch cluster-wide and prove backup/restore with a drill that decrypts a sample credential (B1/B2/B9).

Until items 1–3 are closed, accepting payment exposes the operator to unrecoverable data loss, unbounded AI cost, and contracting under a third party's legal identity. Items 4–7 are required before the deployment can be operated and scaled safely.
