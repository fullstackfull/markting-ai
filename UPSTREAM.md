# Upstream sources

This monorepo vendors two Apache-2.0 open-source projects. Each was imported as a
plain copy of the upstream working tree at the commit below, with the upstream
`.git` directory removed. Nothing inside the imported trees was modified at import time.

| Directory    | Project            | Source URL                                          | Commit SHA                                 | Upstream commit date       | Imported on |
| ------------ | ------------------ | --------------------------------------------------- | ------------------------------------------ | -------------------------- | ----------- |
| `/platform`  | adport             | https://github.com/ynnickw/adport                   | `bde6fedaf380f38fa3aa0df725d6323c15991dd4` | 2026-10-01 20:42:46 +08:00 | 2026-10-01  |
| `/engine`    | paid-media-agent   | https://github.com/langchain-ai/paid-media-agent    | `0cc8109a1984377a573ed8d202b3b054db4d7b90` | 2026-09-13 19:21:20 -07:00 | 2026-10-01  |

## How the import was done

```sh
git clone https://github.com/ynnickw/adport
git clone https://github.com/langchain-ai/paid-media-agent
# copy each working tree, excluding .git, into its target directory
(cd adport           && tar --exclude='.git' -cf - .) | (cd platform && tar -xf -)
(cd paid-media-agent && tar --exclude='.git' -cf - .) | (cd engine   && tar -xf -)
```

The file list of each imported tree was diffed against `git ls-files` of the upstream
checkout to confirm a 1:1 copy (447 files for adport, 239 for paid-media-agent, including
the three relative symlinks in paid-media-agent and the four force-added `.gitkeep`
placeholders under `engine/workspace/`).

## Licensing

Both projects are licensed under the Apache License 2.0. The upstream `LICENSE` files are
kept in place at `platform/LICENSE` and `engine/LICENSE`. Neither upstream ships a `NOTICE`
file. See the root [`NOTICE`](./NOTICE) for attribution.

## Updating

To pull a newer upstream, re-run the import for that directory, update the SHA and date in
the table above, and record any local modifications that had to be re-applied.

## Local modifications to the imported trees

Keep this list current so a future upstream sync knows what to re-apply. Everything else that
markting-ai adds lives outside `platform/` and `engine/` (root `docker-compose.yml`, `infra/`,
`services/`, `docs/`), or as **new files** inside `platform/apps/cloud` that upstream does not have.

### `platform/` (adport) — edited upstream files
| File | Change | Phase |
| --- | --- | --- |
| `apps/cloud/components/nav.tsx` | added the **Assistant** item and its icon to `PRIMARY_ITEMS` | 1 |
| `apps/cloud/app/dashboard/approvals/page.tsx` | added **Source** (engine provenance) and **Actions** (apply / reject) columns | 1 |
| `apps/cloud/app/dashboard/reports/page.tsx` | added the **AI analysis reports** card above the upstream campaign table | 1 |
| `apps/cloud/app/globals.css` | appended Assistant chat styles (additive block at the end of the file) | 1 |
| `apps/cloud/.env.example` | appended the `MARKTING_*` bridge variables | 1 |
| `apps/cloud/app/layout.tsx` | `lang`/`dir` from the locale cookie, Arabic font imports, `I18nProvider` | 2 |
| `apps/cloud/app/globals.css` | physical direction properties → logical; Arabic-first font stack; RTL/bidi rules appended | 2 |
| `apps/cloud/components/ui.tsx` | formatters take a locale; `StatusPill` accepts a translated label | 2 |
| `apps/cloud/components/{nav,shell,auth-screen}.tsx` and every page/component under `apps/cloud/app` and `apps/cloud/components` that held UI copy | inline English replaced by `t()` lookups (dictionaries in `lib/i18n/messages/`) | 2 |
| `apps/cloud/package.json`, `pnpm-lock.yaml` | added `@fontsource/ibm-plex-sans-arabic` (OFL-1.1) | 2 |
| `apps/cloud/test/account-picker.test.tsx`, `test/account-selection.test.tsx` | mock `@/lib/i18n/server` so English assertions keep running | 2 |
| `packages/core/src/policy/engine.ts` | atomic claim→apply, actor-aware approval (human approver, requester≠approver), apply-time policy + budget re-check, immutable-preview digest, pre-write `applying` intent audit, generic-tool gate | P0-A |
| `packages/core/src/policy/pending.ts` | pending-operation state machine (`PendingState`) + actor/digest/result fields; `claim`/`markApplied`/`markFailed`/`markSuperseded`/`ClaimResult` on the store contract | P0-A |
| `packages/core/src/policy/policy.ts` | added `allow_generic_api_writes` (default false) | P0-A |
| `packages/core/src/policy/audit.ts` | added the `applying` intent event to the audit event union | P0-A |
| `packages/core/src/errors.ts` | added P0-A error codes (`APPROVAL_REQUIRED`, `SELF_APPROVAL_FORBIDDEN`, `GENERIC_WRITE_DISABLED`, `REPREVIEW_REQUIRED`, `APPLY_IN_PROGRESS`, `PENDING_SUPERSEDED`, `PENDING_REJECTED`) | P0-A |
| `packages/core/src/tools/{registry,write}.ts`, `src/context.ts`, `src/index.ts` | thread `writeActor`/`allowSelfApproval` through `ToolContext`/`createContext`; export the actor and risk modules | P0-A |
| `packages/meta/src/provider.ts` | assert object→account ownership on typed writes (`meta_set_budget`/`meta_set_lifetime_budget`/`meta_set_campaign_status`/`meta_set_ad_set_status`) before any provider call | P0-A |
| `packages/{snapchat,spotify}/test/*`, `packages/core/test/{policy-engine,synthetic-provider}.test.ts`, `apps/cloud/test/markting-{bridge,sandbox,snapchat-wire}.test.ts`, `packages/meta/test/meta.test.ts` | updated two-step assertions to the idempotent-replay + state-machine + ownership semantics | P0-A |
| `apps/cloud/lib/cloud/repository.ts` | `PostgresPendingStore` implements the atomic SQL `claim` (compare-and-set) + state transitions and persists requester/approver/digest | P0-A |
| `apps/cloud/lib/cloud/runtime.ts` | `principalToActor`; REST/MCP runtimes carry an `api_client` write actor (preview-only, never self-apply) | P0-A |
| `apps/cloud/lib/markting/runtime.ts` | bridge runtime sets the human approver + configured self-approval | P0-A |
| `apps/cloud/lib/markting/assistant.ts` | the engine preview records the requester as the `ai_agent` | P0-A |
| `apps/cloud/app/api/approvals/[id]/apply/route.ts` | four-eyes moved into the policy-engine seam (closes the null-`createdBy` self-approval exemption) | P0-A |

### `platform/` — new files (no upstream counterpart)
`apps/cloud/lib/markting/**`, `apps/cloud/app/api/assistant/**`, `apps/cloud/app/api/approvals/**`,
`apps/cloud/app/api/reports/engine/**`, `apps/cloud/app/dashboard/assistant/**`,
`apps/cloud/app/dashboard/approvals/approval-actions.tsx`, `apps/cloud/app/dashboard/reports/engine-reports.tsx`,
`apps/cloud/test/markting-*.test.ts`, `apps/cloud/test/fixtures/engine-proposal.ts`,
`supabase/migrations/20261002000000_markting_bridge.sql`, `apps/cloud/lib/i18n/**`, `apps/cloud/components/{i18n-provider,locale-switcher}.tsx`, `apps/cloud/app/api/locale/route.ts`, `apps/cloud/test/i18n.test.ts`,
`packages/core/src/policy/{actor,risk}.ts` (P0-A), `packages/core/test/policy-engine-phase0.test.ts` (P0-A),
`supabase/migrations/20261003000000_phase0_write_safety.sql` (P0-A), `apps/cloud/test/pending-claim.database.test.ts` (P0-A).

### `engine/` (paid-media-agent)
No file modified. The engine is hosted by `services/engine-demo/serve_demo.py`, which imports the
package and replaces its write provider at boot; configuration comes from the compose environment.
