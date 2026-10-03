# 01 — Mode-A Deploy Runbook (operator-run)

Run by an operator WITH cloud credentials. This container cannot execute these steps (no cloud access);
they are the exact, ordered procedure. Mark each step's result honestly when you run it.

## 0. Environment contract (`infra/scripts/fill-env.mjs` + your secret store)
Set (via KMS/secret manager, never plaintext): `MARKTING_RUNTIME_MODE=LIVE_RECOMMENDATIONS`,
`SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, model gateway creds + allowlist,
provider OAuth client ids/secrets + `*/oauth/callback` URLs (HTTPS), webhook signing secrets, Stripe
secrets (if billing), session secret, KMS key refs. Verify `/__health` reports no plaintext leak.

## 1. Database (forward-only)
`bash infra/scripts/deploy-migrations.sh` — applies Phase 0→7 migrations with `supabase migration up`
(NO destructive reset). Then run the DB-gated suite against a production-COMPATIBLE staging DB:
`ADPORT_RUN_DATABASE_TESTS=1 SUPABASE_DB_URL=<staging> pnpm --filter @adport/cloud test`.

## 2. KMS / secrets
Provision cloud KMS master key; seal provider/model/webhook/Stripe secrets via the envelope
(`ops/kms.ts`); run a key-rotation drill (old ciphertext decrypts, new writes use the active key).

## 3. TLS / domain
Point `app.<domain>` at the app behind TLS; enforce HTTPS + HSTS + secure cookies; register production
OAuth callback + webhook URLs; verify externally (cert chain, redirect, no public DB/engine port).

## 4. Queue + workers + observability
Deploy the durable queue backend + worker pool; wire logs/metrics/traces + dashboards + alerts.

## 5. Live model + one live provider (READ ONLY)
Connect the approved model via the governed gateway; connect ONE dedicated real ad account (Meta first)
read-only. Confirm provider write tools are inaccessible (`MARKTING_RUNTIME_MODE=LIVE_RECOMMENDATIONS`).

## 6. RC1 smoke test
`BASE_URL=https://app.<domain> node infra/scripts/rc1-smoke.mjs` — login, org, provider read, sync, AI,
recommendations, creative intelligence, reports, billing (if used), alerts, backups.

## 7. Backup/restore proof
Enable automated backups; perform a restore into an isolated environment; verify records + RLS + tenant
boundaries. Do NOT onboard a customer before restore proof.

Mode B (writes) stays HELD — do not enable `LIVE_WRITE_APPROVAL_ONLY` until a controlled write pilot +
rollback pass against a dedicated test account (runbook `docs/phase7/11`).
