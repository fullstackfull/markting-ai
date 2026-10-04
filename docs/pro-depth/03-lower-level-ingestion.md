# 03 — Lower-hierarchy metric ingestion

## One pipeline, more levels
`lib/cloud/live-gatherer.ts` now reads `ad_group` and `ad` levels in addition to account + campaign
(current + previous windows), validates them (the Phase-A `validateReportRow` — reject missing
identity / non-finite / negative / unsupported currency; no silent coercion), normalizes them with
`normalizeReportRows` (tier `PLATFORM_REPORTED`), and passes them to `analyzeAccount` as the
`currentAdGroups/previousAdGroups/currentAds/previousAds` arrays. Diagnoses from every level are
flattened into the media slice, each keeping its own `scope.entityLevel`.

`lib/cloud/reads.ts::readReportRows` already accepted `level: 'ad_group' | 'ad'`; no change needed
there. A provider/level that returns nothing (or errors, under `continue_on_error`) simply yields no
child observations — the engine then produces no child nodes. **Children are never fabricated.**

## Entity ownership (no orphans, no cross-tenant contamination)
- Every observation carries `organizationId` context via the server-derived `TenantPrincipal` (identity
  is never taken from client text), `provider`, `accountId`, and the canonical `entity` (with
  `parentRawId`).
- Child grouping is strictly by provider-native parent linkage within the same provider+account: an
  ad_group attaches to a campaign only when `child.entity.parentRawId === campaign.entity.rawId`; an ad
  attaches to an ad_group the same way. A child whose parent is absent simply does not attach (it is
  not promoted or reparented).
- Tenant isolation is enforced upstream (the read is principal-scoped) and, as of B17, backstopped at
  the DB layer (see `11-tenant-rls.md`).

## Demonstrability (DEMO + CI)
The sandbox and synthetic providers (the only credential-free report paths, used by DEMO and the test
suites) now emit parent-linked ad_group + ad rows (clearly SYNTHETIC). This is what makes the depth
exercisable end-to-end in CI (gatherer → analyze → UI → E2E) without live credentials, which remain
BLOCKED_EXTERNAL.
