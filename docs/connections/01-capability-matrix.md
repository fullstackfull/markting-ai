# 01 — Canonical Capability Matrix

Source of truth in code: `lib/connections/registry.ts`. Status legend: READY / PARTIAL / NOT_STARTED /
BLOCKED_EXTERNAL / UNSUPPORTED. "Live" = adapter makes real authenticated HTTP calls.

## Paid media (11 providers — all LIVE adapters)

| Provider | Auth | Connect | Refresh | Reauth | Disconnect | Revoke | Test | Acct disc | Perm disc | Webhook | Sync | DryRun |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| google | oauth2_pkce | READY | READY | READY | READY | server | READY | READY | PARTIAL | UNSUPPORTED | PARTIAL* | READY |
| meta | long_lived | READY | NO | READY | READY | server | READY | READY | PARTIAL | UNSUPPORTED | PARTIAL* | READY |
| tiktok | long_lived | READY | NO | READY | READY | server | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| microsoft | oauth2_pkce | READY | READY | READY | READY | manual | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| reddit | oauth2 | READY | READY | READY | READY | server | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| apple | service_account | READY | READY | READY | READY | manual | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| snapchat | oauth2 | READY | READY | READY | READY | manual | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| spotify | oauth2 | READY | READY | READY | READY | manual | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| pinterest | oauth2 | READY | READY | READY | READY | manual | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| linkedin | oauth2 | READY | READY | READY | READY | manual | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |
| x | oauth1 | READY | NO | READY | READY | server | READY | READY | NO | UNSUPPORTED | PARTIAL* | NO |

\* Sync = on-demand live reads + a one-time account-inventory snapshot at connect. There is **no background
entity/metric sync job** (no in-repo runner) → scheduled sync is BLOCKED_EXTERNAL. `revoke=manual` means the
local grant is deleted and the user must remove access in the provider console.

## Commerce (5 connectors — read-only; live transport BLOCKED_EXTERNAL)

| Provider | Auth | Read entities | Sync engine | Webhook verifier | Live transport |
|---|---|---|---|---|---|
| salla, zid | merchant_credentials | READY | READY (no runner) | READY (no route) | BLOCKED_EXTERNAL |
| shopify | oauth2 | READY | READY (no runner) | READY (no route) | BLOCKED_EXTERNAL |
| woocommerce, custom | api_key | READY | READY (no runner) | READY (no route) | BLOCKED_EXTERNAL |

## Platform services
| Service | Status | Note |
|---|---|---|
| Stripe | READY / BLOCKED_EXTERNAL until env keys | checkout + webhook + failure capture |
| Supabase/GoTrue | READY | auth provider; session/admin lifecycle APIs not surfaced |
| MCP OAuth 2.1 | READY | mandatory S256 PKCE; daily token purge scheduled |
| Resend email | READY / env-gated | only outbound email path |
| AI gateway | DORMANT / BLOCKED_EXTERNAL | deterministic narrator; no live model |

## Lifecycle capability (canonical, both surfaces)
CONNECT, AUTHENTICATE, REFRESH, REAUTHORIZE, DISCONNECT, REVOKE, TEST_CONNECTION, ACCOUNT_DISCOVERY,
PERMISSION_DISCOVERY, ERROR_DIAGNOSIS, AUDIT, ADMIN_VISIBILITY → all READY as canonical primitives.
HEALTH → READY (deterministic). SYNC (background) / WEBHOOK (ad) / live commerce → BLOCKED_EXTERNAL.
