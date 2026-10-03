# Production Verification Runbook (manual gates)

These checks cannot be fully proven by automated tests in this sandbox. Each must be performed on the
deployed server before the corresponding capability is enabled. Record the result against each item.

## 1. Arabic report shaping (MANUAL GATE — report generation stays blocked if this fails)
The engine report templates and fonts are vendored; automated tests verify configuration and that the
host fails closed, but cannot prove visual Arabic glyph shaping. On the deployed engine host:
1. Generate an Arabic report (`POST /reports/run` with the Arabic template profile, via the cloud).
2. Verify an Arabic-capable font is installed in the image (connected-form shaping needs it; DejaVu
   alone is insufficient).
3. Verify RTL layout and that digits/direction render correctly.
4. Visually verify connected Arabic glyph shaping in the rendered HTML.
5. Verify the PDF output opens and shapes identically.
6. If shaping is broken, keep report generation blocked (do not ship Arabic reports). This is a
   release gate, not an automated test.

## 2. Next.js image-optimization RCE
1. Confirm the deployed Next version against the current advisory for the image-optimization / `next/og`
   CVE line.
2. If on an affected version, bump to the patched release, regenerate `pnpm-lock.yaml`, rebuild, and
   run the e2e smoke before exposing the app.
3. Confirm no `images.remotePatterns` broadens the optimizer to arbitrary remote fetch.

## 3. Secrets & key management
1. `ADPORT_CLOUD_ENCRYPTION_KEY` held in a KMS/secret manager, not a plain env file; rotation runbook.
2. `MARKTING_ENGINE_TOKEN` unique per environment; never shipped to the browser (verify no
   NEXT_PUBLIC_ leak).
3. Stripe keys are the correct mode (test vs live) for the environment.

## 4. Database & migrations
1. Production schema applied via forward-only `supabase migration up` / `db push`. Confirm no deploy
   script runs `db reset`.
2. Backup/restore drill performed on the adport DB and the engine pma_* DB.

## 5. Runtime safety state
1. `MARKTING_RUNTIME_MODE` is DEMO or, for a live pilot, exactly LIVE_READ_ONLY /
   LIVE_RECOMMENDATIONS / LIVE_WRITE_DISABLED — never a write mode until Gate D is signed off.
2. `MARKTING_ALLOW_SELF_APPROVAL=false` in any multi-user environment.
3. `PAID_MEDIA_WRITES_ENABLED=false` and the engine kill switch engaged (the host asserts this at
   boot; confirm `/health` and `/markting/info`).

## 6. Live write pilot (only when Gate D is approved)
1. A dedicated TEST ad account, not a customer account.
2. One human approver distinct from the requester; confirm the four-eyes block with a self-approval
   attempt (expect 403).
3. Confirm the currency exponent for the test account (e.g. a JPY/KWD account) produces the exact
   minor-unit budget in the preview before applying.
4. Apply one budget change; verify the audit chain (validated → applying → applied) and the provider
   reflects exactly the approved amount.
