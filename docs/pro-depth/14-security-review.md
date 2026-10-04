# 14 — Security review (Phase B)

Scope: the new drill-down routes/loaders, the table URL-state, the breakdown explorer, and the tenant
RLS backstop. Reviewed against the B32 checklist.

## Findings

### IDOR via entity ids — SAFE
Every drill-down route (`groups/[groupId]`, `groups/[groupId]/ads/[adId]`, campaign, account) resolves
`params` and then calls `requireDashboardTenant()` before loading anything. The loaders are mode-gated:
- Live: `loadAdGroup`/`loadAd`/`loadAdGroupList`/`loadAdList` short-circuit to `NOT_CONNECTED` and
  return no data — so no live tenant data is reachable through a guessed id.
- DEMO: data comes from the synthetic seed, which belongs to the single demo org — there is no second
  tenant whose data could leak.

### Parent-child ownership validation — SAFE (enforced)
`buildAdGroup(acc, campaignId, adGroupId)` looks up the ad group **inside** the named campaign
(`acc.campaigns.find(campaignId)?.adGroups?.find(adGroupId)`); `buildAd` chains
campaign → ad_group → ad. A mismatched combination (a real group id under the wrong campaign, or an ad
under the wrong group) returns `found: false` — a child from another parent is never rendered.

### Query-param injection — SAFE
Table sort keys are whitelisted via `allowedSorts` in `parseTableState` (an unknown/injected `sort`
falls back to the default); `q` is length-capped; `page`/`pageSize` are integer-clamped (≤100, ≥1);
`cols` is split/trimmed/capped. The `range` param is parsed by `parseRangeParam` (preset whitelist or a
strict `YYYY-MM-DD..YYYY-MM-DD` regex). No search-param value reaches a query builder or the DOM
unescaped.

### RLS bypass / cross-tenant at the DB layer — BACKSTOPPED
The B17 restrictive policy on `adport_backend` (keyed on the `app.current_organization_id` GUC via
`withTenant`) clamps the transactional tenant paths at the DB layer in addition to the application
`where organization_id` scoping. Proven by `test/tenant-rls-backstop.database.test.ts`.

### Platform role confusion — UNCHANGED
Tenant RBAC and platform RBAC remain separate; the backstop targets only `adport_backend`, never
`adport_platform_admin` (its read role is untouched). No Phase B surface crosses the planes.

### Provider account spoofing — N/A in Phase B
No new provider write path (Mode B HELD). The drill-down is read-only; live reads are principal-scoped.

### Breakdown explorer leakage — SAFE by capability gating
The explorer only renders a dimension the connection registry marks reachable; age/gender honour the
protected-dimension guard (reported, never an actionable exclusion); unsupported/RAW_ONLY dimensions
render an explicit unavailable state, never fabricated rows.

## Low-severity observations (non-blocking)
- `seedClientForAccount(unknownId)` falls back to the primary demo client rather than a 404. DEMO-only,
  synthetic data, no cross-tenant implication — a cosmetic correctness nit, noted for Phase C.

## Verdict
No exploitable findings. No new P0/P1 introduced. Defense-in-depth is strengthened (app scoping + DB
RLS backstop).
