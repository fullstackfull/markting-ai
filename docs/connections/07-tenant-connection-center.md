# 07 — Tenant Connection Center

Route: `/dashboard/connections`. Server component loads `listCanonicalConnections(orgId)`; the client
`ConnectionCenter` renders one professional card per integration. Bilingual (en/ar) + RTL-aware; owners/admins
manage, others view-only. Synthetic reviewer org is isolated as before.

## Each card shows
provider + category + **canonical status pill** (with reason tooltip) + **health badge**; accounts
(enabled/total); environment; auth type; token expiry; last authenticated; last sync; granted-scope count;
**missing permissions** (when discoverable); recent error with its **deterministic remediation**; a
**reauthorization-required banner** when an operator requested it; a disabled banner when an operator disabled
the connection; and a BLOCKED_EXTERNAL note where live transport is not wired.

## Actions (server-side, RBAC-gated, audited, capability-gated by the registry)
- **Connect** → opens the wizard (unsupported providers never show it).
- **Reauthorize / Reconnect** → hosted OAuth popup.
- **Test connection** → real `listAccounts()` probe; classifies failures; NOT_CONFIGURED when no credential.
- **Discover accounts** → re-list + refresh inventory (no silent activation).
- **Retry sync** → honest BLOCKED_EXTERNAL (no runner).
- **Disconnect** → provider revoke where supported + cascade-delete the encrypted grant.
- A **manual-removal note** is shown for providers without server-side revoke.

## Wizard (`connection-wizard.tsx`)
Consistent steps: intro (what connects) → permissions requested → authenticate → validate. It **never shows a
success state before validation** — the connection becomes "connected" only after the server verifies the
grant and the tenant finishes account selection. Steps for unsupported capabilities are omitted via the registry.

## Honesty
Every value is read live from the DB or shown as `unknown`/`never`/`NOT_CONFIGURED`/`BLOCKED_EXTERNAL`. No
health light, metric, or control is faked. No secret is ever rendered.
