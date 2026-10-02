# Phase 3 report — Snapchat

Date: 2026-10-02. Re-scoped from "create `packages/snapchat`" to "enable, bridge, verify": the provider
already ships with adport (`platform/packages/snapchat`, imported at `bde6fed`).

## 1. What already existed (studied, not changed)
`packages/snapchat` follows the same pattern as `packages/tiktok`: `client.ts` (OAuth code exchange,
single-flight refresh with rotation, bearer auth, envelope validation, pagination guards),
`provider.ts` (`listAccounts`, normalized `report`, `previewWrite`/`applyWrite` for
`snapchat_create_campaign`, `snapchat_set_budget`, `snapchat_set_campaign_status`), `tools.ts`
(guarded writes via `guardedWriteTool`, one read tool), `schemas.ts` (zod contracts from the
official API docs), 37 wire-format tests, a CLI connect wizard, the hosted OAuth adapter
(`apps/cloud/lib/cloud/provider-oauth-extra.ts`), runtime wiring behind `SNAPCHAT_OAUTH_ENABLED`
and the test-organization allowlist, DB constraints and docs (`platform/docs/providers/snapchat.md`).
Compared with TikTok it is stricter (zod on every envelope, ownership check before any patch, no
generic mutation tool) and narrower (one campaign per status call, no sandbox environment).

## 2. What Phase 3 added
| Piece | Where |
| --- | --- |
| Compose enablement | root `.env.example`: `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`, `SNAPCHAT_OAUTH_ENABLED`, and the allowlist semantics (unset = all orgs; empty string = none). |
| Bridge support | already in Phase 1's `translate.ts` (`snap_ads` → `snapchat_set_budget` with `daily_budget_micro` micros, `snapchat_set_campaign_status` with `ACTIVE`/`PAUSED`); Phase 3 adds a sandbox Snapchat account (`fixture-snap-0001`, SAR, two campaigns) and the `demo-snap` alias so the adport side can demo Snap previews, reports and approvals without credentials. |
| Wire-format tests, no live calls | `apps/cloud/test/markting-snapchat-wire.test.ts`: a synthetic `snap_ads` engine proposal goes through the bridge into the real `SnapchatAdsProvider` over a fixture HTTP layer. Asserts: preview reads only `GET /v1/campaigns/{id}` with bearer auth and sends no mutation; apply sends exactly one `PATCH /v1/adaccounts/{account}/campaigns/{id}` with `content-type: application/json-patch+json` and body `[{op:'replace', path:'/daily_budget_micro', value:240000000}]`; status proposals patch only `/status`; ownership mismatch, the 25 % budget cap, unmapped aliases and unknown targets never reach a mutation; audit shows `validated` → `applied`. |
| Live verification checklist | `docs/snapchat-live-checklist.md` (app registration, cloud config, safe read checks, test-account write checks, engine notes, record table). |

## 3. Verification
| Check | Result |
| --- | --- |
| Upstream package tests `pnpm --filter @adport/provider-snapchat test` | 37 passed |
| Upstream CLI wizard tests (`snapchat-connect`) | pass (73 in the CLI suite) |
| New bridge/wire tests + translate/sandbox/bridge suites | 40 passed |
| `tsc --noEmit` | clean |

## 4. Still open
- No live verification: no Snap app credentials or test account are available in this environment. The checklist is the gate before any real-account use.
- The engine has no `snap_ads` fixture, normalization or admitted writes, so the Assistant cannot *propose* Snapchat changes offline; live Pipeboard catalogs expose Snap read tools only. Adding a fixture means editing `engine/`; proposed as an upstream contribution in `docs/TODO.md` (Phase 4).
