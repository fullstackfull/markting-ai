# 07 — OAuth callback hardening + token lifecycle + connection state machine (items 15, 16, 17, 18)

`lib/markting/ops/token-refresh.ts`, `lib/markting/ops/connection-state-machine.ts`,
`lib/markting/ops/connection-recovery.ts`,
`test/token-refresh.test.ts` (14), `test/connection-state-machine.test.ts` (17),
`test/oauth-hardening.test.ts` (16).

## Connection state machine (item 17)

Canonical 10-state lifecycle: `NOT_CONFIGURED, CONNECTING, CONNECTED, DEGRADED, REAUTH_REQUIRED, EXPIRED,
DISABLED, REVOKED, DISCONNECTED, ERROR`. Mirrors the existing execution `state-machine.ts` style: a
legal-transition table + `canTransition` + `assertConnectionTransition` + `IllegalConnectionTransitionError`.
`transitionConnection(from, to, reason, {now})` returns an auditable event `{from, to, reason, at}`;
illegal moves throw. The only path into `CONNECTED` is via `CONNECTING` or a recovery edge — never straight
from `NOT_CONFIGURED`/`REVOKED`. Clock injectable.

## Connection recovery (item 18)

Pure, exhaustive `Record<RecoveryCondition, RecoveryPlan>` — **no LLM**:

- `AUTH_ERROR → REAUTHORIZE` (→ REAUTH_REQUIRED)
- `TOKEN_EXPIRED → REFRESH_OR_REAUTH` (→ EXPIRED)
- `RATE_LIMIT → BACKOFF` (→ DEGRADED)
- `SCHEMA_CHANGED → QUARANTINE_AND_ALERT` (→ ERROR)
- `SYNC_FAILED → RETRY` (→ DEGRADED)
- `DISABLED → NO_EXECUTION` (→ DISABLED)

Every target is a legal `CONNECTED →` transition, tied to the state machine by a test.

## Token refresh engine (item 15)

Provider-neutral `TokenRefreshEngine` over an injected `TokenRefresher` port (fake in tests; **no live
OAuth**). Delivers: expiry detection with a skew window (`isTokenExpired`), a refresh-needed decision
(`isRefreshNeeded`), a **single-flight lock** (N concurrent callers share one in-flight promise → exactly
one provider call), refresh-failure → `REAUTH_REQUIRED` with a cooldown window, and revocation handling
(`TokenRevokedError` — a revoked grant is never refreshed, no cooldown). Outcomes carry
`nextConnectionState` tying back to the state machine. Clock injectable.

## OAuth callback hardening (item 16)

`test/oauth-hardening.test.ts` exercises the **real** credential-free primitives rather than a parallel
copy: `createPkce` / `buildGoogleAuthorizationUrl` (S256 challenge = base64url(sha256(verifier)); the
verifier never appears on the URL), `digestState` (single-use state stored as a hash), `oauthRedirectUri`
(anchored to the configured public origin, **not** the inbound Host header), `safeReturnPath`
(open-redirect defense), `isOAuthProvider` (provider allow-list). The user/tenant/provider binding,
single-use replay defense, 10-minute expiry, origin gating, and account-discovery gating are modeled by
pure guard helpers (`evaluateCallbackBinding` / `accountDiscoveryAllowed`) that mirror the invariants the
DB-backed `consumeOAuthTransaction` enforces authoritatively.

## BLOCKED_EXTERNAL boundary

The live code→token exchange and the DB transaction consume need real credentials + Postgres + a session;
they are marked BLOCKED_EXTERNAL in comments and never invoked in this phase.
