# 08 — Super Admin Integration Operations Center

Routes under `/admin/integrations` (extends the existing Platform Super Admin — not a separate product).
All reads go through the SELECT-only `adport_platform_admin` role (`platformDb`); all mutations go through
`adport_backend` AFTER a platform guard, reason-required and audited. No secrets are shown.

## `/admin/integrations` (overview)
Fleet totals (total/connected/error/revoked/disabled/reauth-required/expiring≤7d/commerce stores); breakdown by
health, status, **provider** (with drill-down), and error class; **deterministic incident detection**
(auth-failure spike, rate-limit spike, token-expiry wave, reauth backlog, commerce sync-failure spike) with a
**Scan & publish** action that writes deduped rows to the platform notifications inbox; a **Connection Security
Center** (expiring ≤14d, revoked, repeated auth failures, insufficient permissions, operator-disabled); the
**provider capability catalog** (the registry); and connection **search**.

## `/admin/integrations/[provider]` (provider detail)
Registry capabilities + counts (orgs/accounts), status/health/error breakdown, the connection list (org,
status, health, error class, reauth, expiry) with per-connection drill-down, and bulk-safe actions by
connection id.

## `/admin/integrations/connection/[id]` (connection detail)
Non-secret metadata only (status/health/error class/auth type/environment/scopes count/expiry/last
auth-verify-sync/disabled), the sanitized last error, registry capabilities, the connection event history, and
operator actions.

## `/admin/integrations/search`
Connection / ad-account / commerce-store / Stripe-id search. No secrets.

## Admin actions (`lib/connections/platform-actions.ts`)
- **Force health recheck** — recomputes `health_state` from stored signals (deterministic; NOT a live probe —
  operators never hold tenant credentials; the result says so).
- **Request reauthorization** — sets `reauth_required` (tenant sees a banner).
- **Disable / Re-enable** — disable fails closed (grant never loaded into the runtime). SUPER_ADMIN/PLATFORM_OPERATOR.
- **Retry sync** — honest BLOCKED_EXTERNAL (no runner).
- **Scan incidents** — publishes detected incidents to notifications.

Dangerous credential-changing actions are deliberately **NOT** offered — there is no plaintext token-replacement
UI. READ_ONLY_AUDITOR is rejected on every mutation. Every action writes `platform_admin_audit` + `connection_events`.
