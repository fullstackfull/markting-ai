# Production Mode-A — Exit Report

**Honesty rule honored:** this validation container has no cloud-account access, no deploy target, and
no live product-service credentials (provider OAuth, model gateway, commerce, cloud KMS, Stripe,
domain/TLS, managed queue/observability). A real production environment therefore **could not be
provisioned or connected from here**, and nothing live was fabricated. What is genuinely exercisable in
this container was exercised; everything requiring real external infrastructure is BLOCKED_EXTERNAL and
is the operator's to provision via the runbook (`docs/production/01-deploy-runbook.md`).

The 25-item return:

1. **Production URL/host status** — BLOCKED_EXTERNAL (no host provisioned; no cloud access here).
2. **Deployment architecture** — DESIGNED (`docs/production/00-topology.md`): TLS edge → stateless app →
   private Postgres/queue/workers/KMS; engine not public; model server-side only; provider writes OFF in
   Mode A.
3. **Production DB** — BLOCKED_EXTERNAL to provision; schema RUNTIME_PROVEN on real Postgres in CI
   (all Phase 0→7 migrations forward-only, RLS, grants, indexes, isolation). Deploy via
   `infra/scripts/deploy-migrations.sh`.
4. **Migrations** — forward-only, no destructive reset; applied + verified on real Postgres (CI).
   RUNTIME_PROVEN (CI) / BLOCKED_EXTERNAL (production instance).
5. **KMS** — rotation-safe envelope RUNTIME_PROVEN (drill); cloud KMS master keys BLOCKED_EXTERNAL.
6. **TLS** — BLOCKED_EXTERNAL (no edge/domain here); requirements + external checks in the runbook.
7. **Backup/restore** — logical restore drill RUNTIME_PROVEN on real Postgres (data+RLS); cluster
   restore BLOCKED_EXTERNAL.
8. **Queue** — atomic-claim/lease + CAS RUNTIME_PROVEN on real Postgres; durable backend BLOCKED_EXTERNAL.
9. **Observability** — model + redaction + SLO + alert dedup PROVEN in tests; backend BLOCKED_EXTERNAL.
10. **Live AI model tested** — **NO** (BLOCKED_EXTERNAL — no governed-gateway model credentials). The
    gateway + local fallback + deterministic-authoritative-calculations are proven; bilingual narration
    exercised; the agent runtime's own keys were NOT repurposed as a false "live model" result.
11. **Live provider tested** — **NO** (BLOCKED_EXTERNAL — no OAuth app / test account). Read pipeline
    FIXTURE_PROVEN end-to-end.
12. **Real data analyzed** — **NO** (no live data reachable). Intelligence proven on fixtures/sandbox.
13. **Creative ingestion** — PARTIAL: structured creative model + fatigue/contribution proven on
    fixtures; multimodal stays PARTIAL (no multimodal model) — no fabricated visual conclusions.
14. **Commerce status** — NOT_INCLUDED / BLOCKED_EXTERNAL (optional for Mode A; connectors
    FIXTURE_PROVEN, PII excluded from LLM).
15. **Billing status** — PARTIAL: plans/entitlements + Stripe setup scripts present; live Stripe +
    SAR/VAT invoicing UNRESOLVED (not activated as a promise the product can't enforce).
16. **Security validation** — dependency/secret scans GREEN (CI); RLS/tenant isolation,
    Mode-A write lockdown, source separation, SoD, kill-switch fail-closed PROVEN; app-perimeter
    (CSRF/SSRF/session/OAuth-state) is deploy-time hardening.
17. **First customer journey** — intelligence (read) journey READY on the code path; the connect-provider
    and connect-commerce legs are HELD on live credentials. Not run against a real customer.
18. **Tests** — new `production-mode-a.test.ts` (Stage-10 write lockdown + Stage-24 source separation,
    10 cases) + `launch-pilot`/`launch.database` from the prior mission. Full non-DB suite PASSED.
19. **Incidents found** — none new in exercisable scope; the binding finding is environmental: real
    provisioning/live connection is not possible in this container.
20. **Fixes made** — added Mode-A provider-write lockdown (`ops/mode-a.ts`) and no-hidden-demo-data
    source guard (`ops/source-guard.ts`), both fail-closed and tested; authored the deploy runbook +
    forward-only migration script + RC1 smoke harness.
21. **Remaining blockers** — managed hosting, domain + TLS edge, live provider OAuth + a dedicated read
    account, governed live model credentials, cloud KMS, durable queue backend, observability backend,
    automated backups + a restore drill on the production instance, live Stripe + SAR/VAT. All operator-
    provisioned.
22. **Mode A status** — CODE-READY / INFRA BLOCKED_EXTERNAL. The intelligence-only product is proven on
    the code path and against real Postgres; it becomes live once the operator completes the runbook.
23. **Mode B status** — HELD (unchanged). No provider write performed; governance proven on sandbox +
    real Postgres; a live write + rollback pilot against a dedicated test account is required to lift it.
24. **First paying customer status** — **NOT READY.** Production evidence does not support READY: no
    deployed environment, no live provider read, no live model, no restore proof on a production
    instance, no live billing. It becomes READY when the runbook's PASS checklist (TLS, prod DB, KMS,
    backup restore, queue, observability, live AI, live provider read, tenant isolation, billing if
    charged, support) is met on the real deployment.
25. **Everything still unproven** — any real provider/commerce/model call, a deployed production
    environment, cloud-KMS rotation in prod, a cluster restore, live billing, production-scale load, and
    the end-to-end first-customer journey against live data. All BLOCKED_EXTERNAL / HELD — never faked.

## Recommended next action for the operator
Run `docs/production/01-deploy-runbook.md` in order with real credentials; after RC1 smoke + backup
restore pass, Mode A is customer-ready. Autonomous optimization remains DISABLED; Mode B stays HELD.
