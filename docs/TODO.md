# TODO — what is still open

Ordered roughly by what blocks a paying customer first. Each item says what exists today and what is missing.

## 1. Billing and subscriptions
- adport ships Stripe plumbing: `organization_subscriptions`, plan gating in `apps/cloud/lib/cloud/plans.ts`, a webhook at `/api/billing/webhook` and the Plan page. The free `reader` plan strips `tools:write`, so previews need an `operator`+ plan (the demo seed sets it directly in the database).
- Done (see `docs/billing.md`): `infra/scripts/stripe-setup.mjs` provisions products/prices idempotently and fills `STRIPE_*_PRICE_ID`; `make stripe-listen` forwards test webhooks; checkout, portal and webhook were already upstream.
- Missing: Stripe Tax / 15 % VAT (one-line `automatic_tax` edit in `app/dashboard/billing/actions.ts`, your call), SAR pricing (amounts in `plans.ts` and the script), Arabic invoices/receipts (Stripe invoice locale), and whether engine usage (model tokens, report runs) is metered per organization.

## 2. WhatsApp approvals
- Today approvals happen only on the Approvals page (apply = the exact second call through the policy engine) or through REST/MCP.
- Missing: a WhatsApp Business (Cloud API) channel that sends the preview summary and accepts "approve"/"reject", with a signed callback that maps the WhatsApp sender to an adport user and role, then performs the same `registry.call(..., pending_operation_id)`; the 15-minute pending TTL must be re-validated or lengthened for chat-speed approvals; audit entries must record the WhatsApp actor.

## 3. Salla / Zid integration
- Nothing exists yet. Goal: pull store revenue and orders so ROAS uses real revenue, not platform-attributed conversion value.
- Plan: engine-side read-only connectors (the engine documents optional warehouse/CRM sources in `engine/docs/customization.md`) that expose `get_store_revenue` style tools; an adport-side `markting_store_connections` table for OAuth tokens (encrypted like provider credentials); never any write to the store.

## 4. Production deployment gates
- Cloud app: real Supabase project (not the local CLI stack), Vercel or container hosting with the standalone build, per-platform OAuth app approval for Google/Meta/TikTok/Microsoft/Reddit/Snapchat/Spotify/Pinterest/LinkedIn/X (see `platform/docs/providers/cloud-onboarding.md` and `platform/docs/deployment-model.md`), KMS-held `ADPORT_CLOUD_ENCRYPTION_KEY`, Resend for support mail.
- Engine: Postgres with backups for `pma_*` and LangGraph checkpoints, a stable `PAID_MEDIA_APPROVAL_SIGNING_KEY` (today ephemeral unless set), one engine token per environment, network egress limited to model and Pipeboard endpoints, and the kill switch kept engaged in every environment where adport is the writer.
- Both: Docker images built in CI (this sandbox could not reach `deb.debian.org`), secrets scanning (the engine repo ships `.gitleaks.toml`), a CI workflow that runs `make test` plus the upstream suites, and a `scripts/check-upstream-edits.sh` that diffs `platform/` and `engine/` against the SHAs in `UPSTREAM.md`.

## 5. Engine (paid-media-agent) items
- Arabic reports: `report.html.j2` hard-codes `lang="en"` and the image ships only DejaVu fonts. Do it from the engine host by passing forked templates to `ReportRenderer(templates_dir=…)` and adding an Arabic font to the image, without editing `engine/`.
- Snapchat analysis: no `snap_ads` fixture, normalization or admitted writes, so the Assistant cannot propose Snapchat changes offline. Propose upstream: a `snap_ads.json` fixture, `PERFORMANCE_PLATFORMS` entry and `write-policy` rows.
- Live model mode (`MARKTING_ENGINE_MODE=live`) has not been exercised in this repository; verify streaming/timeouts with a real key.
- Thread ownership is one `caller_ref`; consider one engine token per organization if the engine side ever needs requester identity.

## 6. Product polish
- Approvals page: show the full preview (changes, coercions, budget deltas) inline, not only the summary.
- Assistant: persist and list previous threads (`markting_threads` already stores them), streaming responses (the engine API is synchronous today).
- Arabic copy review by a native media buyer; the dictionaries are in `platform/apps/cloud/lib/i18n/messages/`.
- Mirror any future directional icons with the `.mirror-rtl` hook.

## 7. Known upstream defects (not fixed here)
- adport `apps/cloud/test/http.integration.test.ts`: two live-server cases pass `scopes: []` and fail against the scope filter added in upstream `4d24e8e`.
- adport `/api/members` DELETE reads query parameters while the Team page sends a JSON body.
- adport `require_validation` policy flag is never read; budget caps are re-checked only at preview, not at apply.
