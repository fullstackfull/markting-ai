# 05 — Plans & Entitlements (PARTIAL / roadmap)
Plans remain the hard-coded `lib/cloud/plans.ts` catalog resolved by the single `getOrganizationEntitlement`. A
DB-backed plans catalog + `organization_entitlement_overrides` (GAP-PLN-01/02) are NOT yet built; the admin
`/admin/billing` section is an honest PARTIAL stub. The canonical entitlement resolver is preserved — any future
catalog/overrides must feed it (resolution order plan → enterprise → org override → safety ceiling), never a second
check. No historical invoice truth is mutated.
