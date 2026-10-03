# 10 — Feature Flags & Rollouts (Discovery)

## The only flag mechanism in the repo
`lib/cloud/provider-rollout.ts` — a server-owned **provider gating allowlist**:
- Gated set hardcoded: `{snapchat, spotify, pinterest, linkedin, x}` (`:6`).
- `providerAllowedForOrganization(provider, orgId)` (`:9-16`): non-gated providers always allowed; gated ones checked
  against env `ADPORT_PROVIDER_TEST_ORGANIZATION_IDS` (comma-separated org-id allowlist). **Env unset ⇒ allowed to
  all** (`:12`). Synthetic-reviewer orgs always denied (`:10`).
- Enforced at `oauthAvailability` (`provider-oauth.ts:408`) and in the OAuth callback (`callback/route.ts:63`); each
  OAuth app must also be `configured()` (env secrets present) to appear (`provider-oauth.ts:393-411`).

## Granularity & control
- **Per-org** (by explicit id list) and **global** (gated set / env presence).
- **No per-plan flags** (plan entitlements are a separate hard-coded mechanism — see `03`).
- **Controlled only by whoever sets the deployment env var** — a crude deploy-time flag, not a runtime toggle.

## What is MISSING
- **No DB-backed feature-flag table**, no runtime toggle, no admin UI. A flag change requires editing an env var and
  redeploying.
- **No gradual/percentage rollout, no beta-access cohort, no per-plan gating, no emergency per-flag disable.**
- Can a future admin enable feature-per-org / per-plan / beta / gradual / emergency-disable today? **No** — none of
  these mechanisms exist; only the single env allowlist above.

## Implications
A Feature-Flags admin is **greenfield** and should introduce a DB-backed flag model (flag → scope{global|plan|org} →
value, with an audit trail) read through a small evaluator, superseding/absorbing the env-based provider rollout.
Because `provider-rollout.ts` is the only existing gate, the new system should wrap it (keep the deny-synthetic and
configured() checks) rather than fork a parallel mechanism — see duplicate-risk in `13`. See `14`.
