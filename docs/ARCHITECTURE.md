# Architecture of the imported projects (as the code is, not as the READMEs say)

This document describes the two upstream trees vendored into this monorepo, read from the source at
the imported commits (`UPSTREAM.md:9-10`): adport `bde6fedaf380f38fa3aa0df725d6323c15991dd4` in
`platform/` and paid-media-agent `0cc8109a1984377a573ed8d202b3b054db4d7b90` in `engine/`. Every
non-trivial claim carries a `path:lines` citation relative to the repo root. Where a claim could not
be confirmed in code it is marked as such or listed under §6.

The audience is the engineer who will wire these into one Arabic-first "AI media buyer" SaaS. The
one architectural invariant to protect is in §4: adport's `PolicyEngine` is the only thing that may
call a provider's `applyWrite`, and the engine may only *propose*.

---

## 1. Repository layout

```
markting-ai/
├── NOTICE                      attribution for both upstreams
├── UPSTREAM.md                 source URLs, SHAs, import dates
├── docs/ARCHITECTURE.md        this file
├── platform/                   adport  (TypeScript, pnpm 11 + turbo, Node >= 22.13)
│   ├── packages/core           @adport/core: tool registry, policy engine, stores, audit packs
│   ├── packages/{google,meta,tiktok,apple,microsoft,reddit,snapchat,spotify,pinterest,linkedin,x}
│   ├── packages/mcp            stdio MCP server + adapter reused by the cloud /mcp route
│   ├── packages/cli            `adport` binary (Commander)
│   ├── apps/cloud              Next.js 16 dashboard, REST, OAuth broker, OAuth 2.1 server, /mcp
│   ├── supabase/               8 migrations, config.toml (ports 553xx), inert seed.sql
│   ├── plugins/adport          Claude Code / Codex plugin manifests (point at app.adport.dev)
│   ├── scripts/, website/      marketing pages, release guards
│   └── docs/
└── engine/                     paid-media-agent (Python >= 3.11, uv)
    ├── src/paid_media_agent/   package: surfaces/api, runtime/, tools/, domain/, persistence/, reports/
    ├── agent.py, identity.py, channels/, schedules/, sandbox/   Managed Deep Agents (MDA) declarations
    ├── config/                 accounts.example.toml, write-policy.example.toml
    ├── workspace/skills        runtime skills (engine/skills is a symlink to it)
    ├── instructions.md         system prompt
    ├── Dockerfile, docker-compose.yml
    └── docs/, OPERATIONS.md
```

| Fact | Value | Source |
| --- | --- | --- |
| adport workspaces | `packages/*`, `apps/*` | `platform/pnpm-workspace.yaml:1-5` |
| adport package versions | all `0.6.1` | `platform/packages/core/package.json:3`, `platform/packages/cli/package.json:3` |
| adport provider packages | 11 (`PROVIDER_IDS`) | `platform/packages/mcp/src/index.ts:28` |
| cloud app deps | `@adport/core`, `@adport/mcp`, all 11 providers, Next 16.3.1, React 19.2.8, `postgres` 3.4.9, `@supabase/ssr` | `platform/apps/cloud/package.json:14-40` |
| engine entry point | `paid-media-agent = paid_media_agent.cli:main` | `engine/pyproject.toml:49-50` |
| engine base deps | deepagents, managed-deepagents, langchain, langgraph, langchain-mcp-adapters, fastapi, uvicorn, langchain-anthropic/openai, jinja2, pillow | `engine/pyproject.toml:20-42` |
| engine extras | `self-host` (psycopg, langgraph-checkpoint-postgres), `slack`, `reports` (WeasyPrint), model providers | `engine/pyproject.toml:52-67` |

Phase 0 build residue (`dist/`, `.turbo/`, `apps/cloud/.next`, `engine/.venv`, `engine/workspace/{out,analysis}`) is gitignored (`platform/.gitignore:2-5`, `engine/.gitignore:10,19-21`).

---

## 2. adport (platform/)

### 2.1 Provider packages

Every provider is a package `@adport/provider-<id>` whose runtime dependencies are `@adport/core` and
`zod` (`platform/packages/tiktok/package.json:22-25`, `platform/packages/snapchat/package.json:16`); two add
a third: `fflate` for Microsoft (`platform/packages/microsoft/package.json:24`) and `oauth-1.0a` for X
(`platform/packages/x/package.json:16`). Every package has at least these four files; several add helpers
(`apple/src/jwt.ts`, `microsoft/src/csv.ts`, `meta/src/outputs.ts`, `schemas.ts` in
linkedin/pinterest/snapchat/spotify/x, and `analytics.ts`/`entities.ts`/`oauth.ts`/`writes.ts` in x, whose
write planning lives in `writes.ts`, not `provider.ts`):

- `src/client.ts` — HTTP client with injectable `fetchImpl` for tests.
- `src/provider.ts` — class implementing `AdProvider` (`platform/packages/core/src/provider.ts:71-82`): `id`, `capabilities()`, `listAccounts()`, `report(query)`, `previewWrite(op, guard)`, `applyWrite(op, guard)` (doc comment: "Only the policy engine may call this", line 78), optional `standardActions()` (itself with an optional `pauseCampaign?`, lines 67-69, 81).
- `src/tools.ts` — `<id>Tools(provider)` returning `AnyToolDefinition[]`. Reads use `defineTool({annotations:{readOnly:true}})`; writes use `guardedWriteTool` (see §2.3).
- `src/index.ts` — `resolve<Id>Credentials(store)` (record in the local `${ADPORT_HOME}/credentials.json` store, else env vars, else `undefined`; `platform/packages/core/src/credentials/store.ts:24-31`) and `create<Id>Module(store)` returning `{provider, tools}` or `undefined` (`platform/packages/snapchat/src/index.ts:10-31`, `platform/packages/tiktok/src/index.ts:10-42`). All eleven packages export this pair, but it is the **local/CLI/stdio-MCP** assembly path only (`platform/packages/mcp/src/index.ts:44-54`): the cloud app bypasses it and builds `new <Id>Provider(new <Id>Client(decryptedCreds))` per provider inside `createTenantRuntime` (`platform/apps/cloud/lib/cloud/runtime.ts:69-139`). A new provider therefore needs wiring in both places.

Preview mode differs per provider: TikTok and Snapchat return `capabilities(): {serverDryRun:false}` (`platform/packages/tiktok/src/provider.ts:62-65`, `platform/packages/snapchat/src/provider.ts:20`) and set `serverValidated:false` on previews (`platform/packages/tiktok/src/provider.ts:229`, `platform/packages/snapchat/src/provider.ts:84-87`). Only Google and Meta report `serverDryRun: true` (`platform/packages/google/src/provider.ts:50`, `platform/packages/meta/src/provider.ts:81`); the other nine providers and `MockProvider` return `false` (e.g. `platform/packages/apple/src/provider.ts:97`, `platform/packages/x/src/provider.ts:18`, `platform/packages/core/src/testing/mock-provider.ts:70`).

**Snapchat already exists as a package and is reachable from the cloud app, but behind rollout gates.**
`packages/snapchat` ships OAuth helpers (`buildSnapchatAuthUrl`, `exchangeSnapchatCode`), a refresh-token
client, accounts, normalized reports and four tools: `snapchat_list_campaigns` (read) and guarded
`snapchat_create_campaign`, `snapchat_set_campaign_status`, `snapchat_set_budget`
(`platform/packages/snapchat/src/tools.ts:6-17`). Its zod wire contracts, which a Phase 3 clone must copy,
are in `platform/packages/snapchat/src/schemas.ts:28-44`: `createCampaignSchema` defaults `status` to
`PAUSED` and `objective` to `BRAND_AWARENESS`; `setBudgetSchema` takes `field`
(`daily_budget_micro|lifetime_spend_cap_micro`, default daily) and `budget_micros`. `plan()` enforces
`op.provider === 'snapchat'`, `end_time > start_time` and campaign ownership of the selected account, all
as `INVALID_INPUT` (`platform/packages/snapchat/src/provider.ts:92-121`). Its `standardActions().pauseCampaign`
maps to `snapchat_set_campaign_status` with `status:'PAUSED'` (`provider.ts:21-25`). It is a dependency of
the cloud app (`platform/apps/cloud/package.json:23`), has an OAuth adapter and a runtime block
(`platform/apps/cloud/lib/cloud/provider-oauth-extra.ts:32-39`, `platform/apps/cloud/lib/cloud/runtime.ts:69-73`)
and is in the DB provider CHECK constraints (`platform/supabase/migrations/20260831010651_provider_expansion.sql:3-17`).
Two server-side gates apply: (1) cloud OAuth start/exchange run only when `SNAPCHAT_OAUTH_ENABLED='true'`
**and** `SNAPCHAT_CLIENT_ID/SECRET` are set (`provider-oauth-extra.ts:19-26`; the env default is `'false'`,
`platform/apps/cloud/lib/env.ts:60`); (2) the tenant runtime instantiates the provider only when
`providerAllowedForOrganization('snapchat', orgId)` passes — snapchat/spotify/pinterest/linkedin/x are
`gatedProviders` controlled by `ADPORT_PROVIDER_TEST_ORGANIZATION_IDS` (`platform/apps/cloud/lib/cloud/provider-rollout.ts:6-16`;
semantics in §2.9). The adapter's `revoke()` is a stub returning `false` (`provider-oauth-extra.ts:38`), so a
Snapchat disconnect always answers `providerRevocationRequired: true`. Phase 3 of the plan ("create
packages/snapchat") should be re-scoped to verify/extend, and the compose stack must set both gates for
Snapchat to appear.

TikTok, for contrast, exposes nine tools (three reads, six guarded writes including generic
`tiktok_api_create/update/delete`; `platform/packages/tiktok/src/tools.ts:21-126`) and authenticates with a
long-lived token + app id/secret, no refresh, plus an optional `sandbox` flag (`TIKTOK_SANDBOX=true` or credential
`sandbox:'true'`; `platform/packages/tiktok/src/index.ts:10-32`, module factory at `34-42`). Status
vocabulary and budget units differ per provider (Snapchat: integer micros, `ACTIVE|PAUSED`; TikTok: float
whole currency units, `ENABLE|DISABLE`, `campaign_ids[]`; `platform/packages/tiktok/src/provider.ts:67-74`,
`platform/packages/tiktok/src/tools.ts:97-106`; Google: integer `daily_budget_micros`, `platform/packages/google/src/tools.ts:53-60`),
which any bridge must translate.

### 2.2 Tool registry

A tool is `{name, namespace, description, input (zod object), output?, annotations, handler(input, ctx)}`.
`defineTool` defaults `readOnly=false`, `destructive=!readOnly`, `openWorld=true` unless namespace is
`core|mock|audit` (`platform/packages/core/src/tools/registry.ts:38-58`). `ToolRegistry.register` throws a
plain `Error` on duplicate names; `get` throws `UNKNOWN_TOOL`; `call(name, raw, ctx)` zod-parses
(`INVALID_INPUT`), awaits the optional `ctx.authorizeToolCall(tool, parsed)`, then runs the handler
(`registry.ts:60-91`).

`createContext(options)` builds the runtime: `ProviderRegistry`; `loadPolicy(options.policyPath)` **always**
(even when `engine` is injected — so the cloud's `policySource` is `defaults` or a local file, and an
`ADPORT_POLICY` env var pointing at a missing/invalid file throws inside the cloud runtime;
`platform/packages/core/src/context.ts:46`, `policy.ts:51-59`); `engine = options.engine ?? new PolicyEngine(policy)`;
a file-backed `CredentialStore` on `ctx.credentials` in every runtime (`context.ts:48,66`);
registers `builtinTools()` + `auditTools()`, each `ProviderModule`'s provider and tools, and
`MockProvider`/`mockTools()` only when `includeMock`; finally sets `ctx.registry = registry` so tools such as
`recommendation_apply` can invoke other tools (`context.ts:41-72`; `ToolContext` at `tools/registry.ts:14-24`).
`CreateContextOptions` are `policyPath`, `providerModules`, `includeMock`, `engine`, `authorizeToolCall`,
`findings` (`context.ts:16-31`); the last four are the hosted-runtime injection points.

Tool inventory registered by core itself:

| Namespace | Tools | Source |
| --- | --- | --- |
| `core` | `accounts_list`, `report` | `platform/packages/core/src/tools/builtin.ts:26,51` |
| `audit` | `audit_preview`, `audit_run`, `recommendations_list`, `recommendation_dismiss`, `recommendation_apply` | `platform/packages/core/src/audit/tools.ts:20,43,67,82,94` |
| `mock` (demo only) | `mock_list_campaigns`, `mock_create_campaign`, `mock_set_budget`, `mock_set_campaign_status`, `mock_remove_campaign` | `platform/packages/core/src/testing/mock-provider.ts:249-288` |
| `demo` (exported, registered by no runtime) | `demo_list_campaigns`, `demo_set_budget` on `SyntheticProvider` (`id:'demo'`) | `platform/packages/core/src/testing/synthetic-provider.ts:36-39,119-129`; export `core/src/index.ts:60` |

`recommendation_apply` is itself write-capable (`annotations: {readOnly:false}`, `audit/tools.ts:104`): it
re-enters `ctx.registry.call` with the finding's `proposedAction.tool`/`input` plus an optional
`pending_operation_id` (`audit/tools.ts:121-128`), so REST scope checks treat it as `tools:write` and
`proposedAction.input` is trusted as stored. Guarded tools declare `output: writeOutput` and
`annotations: {readOnly:false, destructive: def.destructive ?? true}` (`platform/packages/core/src/tools/write.ts:37-38`);
`ToolRegistry.call` treats a `null`/`undefined` body as `{}` (`registry.ts:84`), so a missing body fails zod
with `INVALID_INPUT` on `account_id`, not `UNKNOWN_TOOL`.

Error codes are exactly eight: `POLICY_VIOLATION`, `PENDING_NOT_FOUND`, `PENDING_EXPIRED`,
`PENDING_MISMATCH`, `PROVIDER_ERROR`, `INVALID_INPUT`, `NOT_CONNECTED`, `UNKNOWN_TOOL`
(`platform/packages/core/src/errors.ts:1-9`). Reads fail closed: `ProviderRegistry.get(id)` throws
`NOT_CONNECTED` when that provider id is not registered (`platform/packages/core/src/provider.ts:91-100`), and
`selectConnectedProviders(registry)` throws `NOT_CONNECTED` only when no provider id is requested and none are
registered (`provider.ts:108-118`). Unlike `ToolRegistry`, `ProviderRegistry.register` is a plain `Map.set` and
silently replaces a provider with the same id (`provider.ts:87-89`). `guardedWriteTool` resolves the provider via
`ctx.providers.get(def.provider)` before touching the engine (`write.ts:44`), so a write against an unconnected
provider fails `NOT_CONNECTED` before any policy or audit step.

### 2.3 Policy engine (preview → pending approval → apply)

`guardedWriteTool(def)` is the only sanctioned write wrapper (`platform/packages/core/src/tools/write.ts:15-68`).
It extends the provider payload with `account_id` and optional `pending_operation_id` (lines 24-30), builds
`WriteOperation {tool, provider, accountId, kind, payload}` (lines 45-51), and:

- **without** `pending_operation_id`: `ctx.engine.validate(provider, op)` → returns `{status:'pending_validation', applied:false, pending_operation_id, expires_at, preview, next_step}` (lines 52-62);
- **with** it: `ctx.engine.apply(provider, op, id)` → `{status:'applied', applied:true, result, preview}` (lines 64-65).

`PolicyEngine` (`platform/packages/core/src/policy/engine.ts:47-165`; `validate` 58-85, `apply` 87-125, private
checks 127-164). `guard()` is the only place the policy is translated into a `WriteGuard`, which has a
single field `forcePausedCreation` (`engine.ts:54-56`; `platform/packages/core/src/provider.ts:49-51`).

| Step | `validate` (lines 58-85) | `apply` (lines 87-125) |
| --- | --- | --- |
| 1 | `pending.sweep()` (deletes/consumes expired) | `pending.get(id)` → `PENDING_NOT_FOUND` |
| 2 | `checkStaticPolicy` — `protected_accounts.includes(accountId)` (127-131) | `expiresAt < now` → delete + `PENDING_EXPIRED` (local store). In the cloud this holds only until the next `validate` in that organization: `PostgresPendingStore.sweep` marks expired rows `consumed_at` (`platform/apps/cloud/lib/cloud/repository.ts:420-425`) and `get` hides consumed rows (`397`), after which `apply` yields `PENDING_NOT_FOUND` instead. A bridge must treat both codes as "re-validate". |
| 3 | `provider.previewWrite(op, {forcePausedCreation: policy.paused_creation})`. Cloud only: the provider is an `AccountScopedProvider` whose `previewWrite` first calls `assertAllowed` and throws `POLICY_VIOLATION` when `op.accountId` is not an enabled `organization_ad_accounts` row (`platform/apps/cloud/lib/cloud/account-scope.ts:19-27,81-84`; wrapped at `runtime.ts:56-61`) | provider or `hashOperation(op)` differs → `PENDING_MISMATCH` |
| 4 | `checkBudgetPolicy` — abs cap only when `max_daily_budget_micros !== null && toMicros > cap`; pct cap only when `max_budget_delta_pct !== null` **and** the delta has `fromMicros > 0`, so creations and `null` caps skip it (133-153) | `checkStaticPolicy` again (budget caps are **not** re-checked, and the preview is not regenerated) |
| 5 | `pending.put({id: randomUUID, provider, opHash, op, preview, createdAt, expiresAt: now + pending_ttl_minutes})` | `provider.applyWrite(op, guard)` — the only production call site outside a delegating wrapper (line 113). In the cloud this lands on `AccountScopedProvider.applyWrite`, which re-runs `assertAllowed` and then delegates to the wrapped provider (`account-scope.ts:86-89`); provider unit tests call `applyWrite` directly. |
| 6 | audit `validated` | audit `applied` with `resourceIds` and the **stored** `pending.preview.summary`; returns `pending.preview`, not a fresh one (114-124); `pending.delete(id)` |

Earlier still, in the cloud, `createAccountScopeAuthorizer` rejects an `account_id`/`customer_id` outside the
tenant's enabled set before any handler runs (`account-scope.ts:36-56`, invoked at
`platform/packages/core/src/tools/registry.ts:88`).

Any rejection by the engine's **own** checks (protected accounts, budget caps) appends a `rejected` audit event
and throws `POLICY_VIOLATION` with the policy in `details` (lines 155-164). Rejections thrown below or above the
engine leave **no** audit row: the cloud account-scope checks (`account-scope.ts:19-27,36-56,81-89`, also
`POLICY_VIOLATION` but with `details: {provider, accountId}`) and provider validation errors inside `previewWrite`
(`INVALID_INPUT`, e.g. `platform/packages/snapchat/src/provider.ts:94-120`). `hashOperation` is sha256 over
key-sorted JSON of `{tool, provider, accountId, kind, payload}` (lines 19-40). The hash is computed over the
**zod-parsed** payload: `ToolRegistry.call` parses before the handler (`registry.ts:84-89`) and `op.payload` is
that parsed object (`write.ts:40-51`), so the apply call must carry values that parse to the same payload — key
order is free and zod defaults/transforms are normalised (e.g. Snapchat's defaulted `objective`/`status`/`field`,
`platform/packages/snapchat/src/schemas.ts:32-33,42`). The stored `pending_operations.operation.payload` is this
post-parse form, which is why replaying it is safe.

Policy schema and defaults (`platform/packages/core/src/policy/policy.ts:7-20`): `require_validation=true`,
`paused_creation=true`, `max_budget_delta_pct=25`, `max_daily_budget_micros=null`, `protected_accounts=[]`,
`pending_ttl_minutes=15`. Local resolution order: explicit path → `$ADPORT_POLICY` → `./adport.policy.yaml`
→ `${ADPORT_HOME}/policy.yaml` → defaults; a missing explicit/env path is a hard error (`policy.ts:38-63`).
In the cloud the policy comes from `public.organization_settings.policy` parsed by `policySchema`
(`platform/apps/cloud/lib/cloud/repository.ts:51-56`); `getOrganizationPolicy` parses `rows[0]?.policy ?? {}`,
so an organization without a settings row silently gets the schema defaults.

**`require_validation` is inert.** It exists in the schema (`policy.ts:9`), the DB column default
(`platform/supabase/migrations/20260817171039_cloud_initial_schema.sql:48`), the policy form
(`platform/apps/cloud/app/dashboard/policies/policy-form.tsx:51`) and the marketing page
(`platform/website/index.html:371`); the only other reference is a CLI test
(`platform/packages/cli/test/program.test.ts:150-152`). No runtime code branches on it; the two-step gate
in `guardedWriteTool` is unconditional.

Coercions are provider-side: the engine only passes `forcePausedCreation`, and all eleven providers honour
it on create paths, recording the coercion in `preview.coercions` (e.g.
`platform/packages/snapchat/src/provider.ts:100,105`, `platform/packages/tiktok/src/provider.ts:268-272,325`,
`platform/packages/google/src/provider.ts:319,392,637-638`, `platform/packages/meta/src/provider.ts:434,551`,
`platform/packages/x/src/writes.ts:18`; mock: `platform/packages/core/src/testing/mock-provider.ts:137-140`).
The engine never verifies that a provider applied the coercion.

### 2.4 Pending approvals

Interface `PendingOperationStore {put, get, delete, sweep}` over `PendingOperation {id, provider, opHash, op,
preview, createdAt, expiresAt}` (`platform/packages/core/src/policy/pending.ts:6-22`).

- **Local** `PendingStore`: `${ADPORT_HOME}/pending/<id>.json`, dir 0700 / file 0600, id must match `/^[a-zA-Z0-9-]+$/` (`pending.ts:28-38`); `sweep` deletes expired files and skips unreadable ones (`pending.ts:55-73`).
- **Cloud** `PostgresPendingStore` (`platform/apps/cloud/lib/cloud/repository.ts:371-426`): `put` inserts into `public.pending_operations` with `created_by = principal.userId ?? null` (`repository.ts:381`; nullable column, `20260817171039_cloud_initial_schema.sql:137`), so rows created through an API key or MCP OAuth token may carry no `created_by`, and neither `api_key_id` nor the OAuth token id is recorded on the pending row — only the matching `validated` audit event carries `api_key_id` (`repository.ts:284-287`). `get` filters `organization_id` and `consumed_at is null`; `delete` and `sweep` **set `consumed_at`** rather than deleting rows, and `delete` does not check `consumed_at`, so a second apply of an already-applied id returns `PENDING_NOT_FOUND`, not `PENDING_MISMATCH`. Consumed rows stay in the table for audit/retention. It does not declare `implements PendingOperationStore`; compatibility is structural.

The dashboard Approvals page (`platform/apps/cloud/app/dashboard/approvals/page.tsx:7-37`) renders
`listPendingOperations(org)` — rows with `consumed_at is null and expires_at > now()`, newest first,
limit 50, returning the full `operation` (incl. post-parse `payload`) and `operation_hash`
(`repository.ts:696-704`) — as a **read-only table** (Operation = `preview.summary`, falling back to the
tool name, with the pending id beneath; Provider, Account, Kind, Expires; `page.tsx:20-29`). A row silently
disappears from the page after `pending_ttl_minutes` with no expiry signal. There is no
approve/apply/reject control anywhere in the cloud app. Approval today means: the agent re-calls the same
tool with `pending_operation_id` through REST or MCP. The MCP widget's "Approve and apply" button does
exactly that, re-sending the server-supplied `_meta.approval.arguments` and special-casing
`recommendation_apply` (`platform/packages/mcp/src/ui.ts:270-275,289,294`).

### 2.5 Audit events

Core `AuditEntry {ts, event: validated|applied|rejected|note, provider, tool, accountId, pendingId?, summary,
details?}` and `AuditEntryStore.append` (`platform/packages/core/src/policy/audit.ts:5-20`). Local `AuditLog`
appends JSONL to `${ADPORT_HOME}/audit/audit-YYYY-MM.jsonl` (0700/0600) (`audit.ts:22-35`).

Cloud `PostgresAuditStore.append` → `recordAudit(principal, entry)` inserting into `public.audit_events`
with `actor_user_id` and `api_key_id` (`platform/apps/cloud/lib/cloud/repository.ts:268-291,428-434`); the
MCP OAuth `oauthTokenId`/`clientId` on the principal (`platform/apps/cloud/lib/cloud/types.ts:3-6`) are not
stored, so remote-MCP callers are attributable only via `actor_user_id`. `provider`, `tool` and `account_id`
are `not null` (`20260817171039_cloud_initial_schema.sql:160-162`), so non-write events must supply
placeholders (the app uses `'cloud'`/`'*'`).
The cloud event union is wider than core: 15 values (`validated, applied, rejected, note, connected,
revoked, api_key_created, api_key_revoked, member_invited, member_role_updated, member_removed,
settings_updated, deletion_requested, subscription_updated, account_access_updated`), enforced by a
DB CHECK (`platform/supabase/migrations/20260817171039_cloud_initial_schema.sql:155-159`, widened at
`20260828120000_cloud_plans_and_account_scope.sql:165-171`). A new event kind (e.g. `proposed`) needs
a migration and a TypeScript union update; otherwise reuse `note`.

The Audit page shows the latest 150 rows (`platform/apps/cloud/app/dashboard/audit/page.tsx:11`;
`listAuditEvents` defaults to 100, `repository.ts:719-727`). There is no cloud audit export route;
`adport audit show|export` read the local JSONL through `AuditLog.read(limit)`
(`platform/packages/core/src/policy/audit.ts:38-53`; `platform/packages/cli/src/program.ts:161,182`), and core
has no equivalent reader for the Postgres store.

### 2.6 Cloud app routes (full route table)

Enumerated from `find app -name route.ts -o -name page.tsx` (44 files; the two `oauth-protected-resource`
routes share one row below, `app/.well-known/oauth-protected-resource/mcp/route.ts:1` is
`export { GET } from '../route'`). Not matched by that find but gating every dashboard page:
`app/dashboard/layout.tsx:8-9` redirects to `/onboarding` while `organization_onboarding.completed_at` is
null, and `app/onboarding/page.tsx:25` redirects back once complete. A new `/dashboard/assistant` or
`/dashboard/reports` page inherits this gate; a fresh local org must first `POST /api/onboarding` with
`{currentStep:'complete', complete:true}` as owner/admin (`lib/cloud/onboarding.ts:30-43`). Auth legend:
**S** = Supabase session cookie via `sessionPrincipal()`/`requireDashboardTenant()`; **K** = Bearer `adp_…`
API key or MCP OAuth JWT via `apiPrincipal()`, which also enforces a durable 120 req/min limit per
credential and throws 429 (`platform/apps/cloud/lib/cloud/auth.ts:9-37`; `enforceRateLimit`,
`lib/cloud/repository.ts:355-369`); **–** = public. Session routes accept `organization_id` (query or body);
without it the dashboard always resolves the user's **oldest** membership (`lib/cloud/dashboard.ts:38-41`,
`repository.ts:30-49`) — there is no org switcher.

| Method / path | Auth | What it does | File |
| --- | --- | --- | --- |
| GET `/` | – | redirect if signed in, else AuthScreen | `app/page.tsx` |
| GET `/login` | – | same as `/` | `app/login/page.tsx` |
| GET `/auth/callback` | – | Supabase PKCE `exchangeCodeForSession` | `app/auth/callback/route.ts` |
| GET `/onboarding` | S | welcome→connect→accounts→agent→complete flow | `app/onboarding/page.tsx` |
| GET `/account-selection` | S (any member; selection content only for owner/admin, otherwise an "unavailable" page, `page.tsx:14-22`) | pick discovered accounts after OAuth | `app/account-selection/page.tsx` |
| GET `/dashboard` | S | Overview: connections, 5 pending ops, audit count, live 7-day summary | `app/dashboard/page.tsx` |
| GET `/dashboard/connections` | S | provider OAuth cards | `app/dashboard/connections/page.tsx` |
| GET `/dashboard/accounts` | S | enable/disable ad accounts | `app/dashboard/accounts/page.tsx` |
| GET `/dashboard/reports` | S | live `report` tool call, last_30_days, campaign table | `app/dashboard/reports/page.tsx` |
| GET `/dashboard/findings` | S | `PostgresFindingsStore.list()` | `app/dashboard/findings/page.tsx` |
| GET `/dashboard/approvals` | S | read-only pending-operations table | `app/dashboard/approvals/page.tsx:7-37` |
| GET `/dashboard/audit` | S | latest 150 audit events | `app/dashboard/audit/page.tsx` |
| GET `/dashboard/policies` | S | policy form → PATCH `/api/settings` | `app/dashboard/policies/page.tsx` |
| GET `/dashboard/team` | S | members; rename shown to owner/admin, danger zone to owner only (`page.tsx:17,22`) | `app/dashboard/team/page.tsx` |
| GET `/dashboard/agents` | S | MCP URL, REST hints, API keys | `app/dashboard/agents/page.tsx` |
| GET `/dashboard/billing` | S | Stripe plans | `app/dashboard/billing/page.tsx` |
| GET `/api/v1/accounts` | K, `tools:read` | `registry.call('accounts_list')` | `app/api/v1/accounts/route.ts` |
| POST `/api/v1/tools/[tool]` | K, scope by `annotations.readOnly` | `registry.call(tool, body)` — the REST write path | `app/api/v1/tools/[tool]/route.ts:5-17` |
| POST/GET/DELETE `/mcp` | K | stateless Streamable-HTTP MCP (`sessionIdGenerator: undefined`, line 55), `productionOnly:true` (43), `scopes: principal.scopes` (51): write tools are hidden for viewers and registered only as `PLAN_LIMIT` error stubs when the plan lacks write access (23-39, 52); errors return `HttpError.status` or 401 with a `WWW-Authenticate: Bearer resource_metadata=…` header (65-70) | `app/mcp/route.ts:11-77` |
| GET `/api/dashboard/summary` | S | `readReport(…,'last_7_days')` | `app/api/dashboard/summary/route.ts` |
| PATCH `/api/settings` | S (owner/admin) | body `{organizationId}` plus `organizationName` or **both** `policy` and `dataRetentionDays` (`route.ts:7-17`); retention above `plan.maxRetentionDays` → 402 (`lib/cloud/tenant-admin.ts:172-180`); audits `settings_updated` | `app/api/settings/route.ts` |
| GET `/api/members` | S | list via `private.organization_member_directory` | `app/api/members/route.ts:15-23` |
| POST/PATCH/DELETE `/api/members` | S (owner/admin; only an owner grants `admin`; admins cannot change/remove owners or admins; last owner protected) | invite (Supabase admin invite for unknown emails; `plan.maxMembers` → 402) / change role / remove | `app/api/members/route.ts:25-58`; `lib/cloud/tenant-admin.ts:11-18,31-44,87-102,118-133` |
| POST `/api/account-access` | S (owner/admin, `repository.ts:639`) | enable/disable a discovered account; refused while the provider connection still has `account_selection_id` or is not `connected` (`repository.ts:646-648`); plan limit → 402 (`lib/cloud/plan-limit.ts:19`) | `app/api/account-access/route.ts` |
| POST `/api/account-selection` | S (owner/admin via `requireManager`, and the same `user_id` who started the OAuth flow; `lib/cloud/account-selection.ts:17-20,85,95`) | commit a subset of the encrypted discovery snapshot into `organization_ad_accounts`, clear `connections.account_selection_id`, delete the snapshot, audit `account_access_updated` | `app/api/account-selection/route.ts` |
| GET `/api/api-keys` | S (owner/admin) | list active `adp_` keys **and** MCP OAuth grants (`route.ts:19-28`) | `app/api/api-keys/route.ts` |
| POST `/api/api-keys` | S (owner/admin) | create `adp_` key (shown once); requested scopes are intersected with the plan-gated principal scopes, so `tools:write` is silently dropped on the Free plan (`route.ts:39-40`; `lib/cloud/plans.ts:93-103`) | `app/api/api-keys/route.ts` |
| DELETE `/api/api-keys/[id]` | S (owner/admin, `route.ts:9`) | revoke | `app/api/api-keys/[id]/route.ts` |
| DELETE `/api/connections/[provider]` | S (owner/admin) | revoke grant at the provider only when the adapter is configured, delete connection, audit `revoked`; the four extra adapters' `revoke()` always return `false`, so Snapchat/Spotify/Pinterest/LinkedIn answer `providerRevocationRequired: true` (`route.ts:27-42`; `lib/cloud/provider-oauth-extra.ts:38,46,54,62`) | `app/api/connections/[provider]/route.ts` |
| POST `/api/deletion` | S (owner), body `{organization_id, confirmation:'DELETE'}` | revoke the Google refresh token only (no other provider), audit `deletion_requested`, `delete from public.organizations` (cascade), then delete the Supabase auth user when it has no remaining memberships (`route.ts:13-26`). `public.deletion_requests` is never written. | `app/api/deletion/route.ts` |
| POST `/api/onboarding` | S (owner/admin, `lib/cloud/onboarding.ts:26-34`) | upsert `organization_onboarding` step / agent / `completed_at` (`onboarding.ts:30-43`); Zod → 400, else 403 | `app/api/onboarding/route.ts` |
| POST `/api/support` | S | feedback row + Resend email | `app/api/support/route.ts` |
| OPTIONS/POST `/api/waitlist` | – (origin allowlist: `adport.dev` hosts, plus `localhost`/`127.0.0.1` outside production, `route.ts:13-19`; a rebrand must change it) | `private.cloud_waitlist` | `app/api/waitlist/route.ts` |
| POST `/api/billing/webhook` | Stripe signature | subscription events | `app/api/billing/webhook/route.ts` |
| GET `/api/oauth/[provider]/start` | S (owner/admin) | rollout allowlist → 403, unconfigured adapter → 503; hashed state + PKCE → provider consent; default return path `/dashboard/accounts?select_provider=<p>`, optional `popup_id` (`route.ts:29-49`) | `app/api/oauth/[provider]/start/route.ts` |
| GET `/api/oauth/[provider]/callback` | S (owner/admin, re-checked against the transaction's org after consent, `route.ts:58-61`; rollout re-checked at 63) | consume one-time state, exchange code, upsert connection + encrypted credential, build an **unscoped** runtime (`enforceAccountScope: false`, line 78) to `listAccounts()`, stage encrypted selection, audit `connected`; on verification failure set connection `error`, audit `note`, redirect to the return path with `?error=`; on success redirect to `/account-selection?selection_id=`. Every failure is a redirect, never JSON (`route.ts:78-127`) | `app/api/oauth/[provider]/callback/route.ts` |
| GET `/oauth/provider-complete` | – | popup close page | `app/oauth/provider-complete/page.tsx` |
| GET `/oauth/authorize` | S | MCP OAuth consent page | `app/oauth/authorize/page.tsx` |
| POST `/oauth/authorize/consent` | S | issue auth code | `app/oauth/authorize/consent/route.ts` |
| POST `/oauth/register` | – (20/min, keyed on `x-vercel-forwarded-for`/`x-forwarded-for` or `'unknown'`, so off-Vercel all registrations share one bucket, `route.ts:8-9`) | dynamic client registration, public clients only | `app/oauth/register/route.ts` |
| POST `/oauth/token` | – | code/refresh grant, PKCE S256, resource = `${base}/mcp` | `app/oauth/token/route.ts` |
| POST `/oauth/revoke` | – | revoke token | `app/oauth/revoke/route.ts` |
| GET `/.well-known/oauth-authorization-server` | – | issuer metadata | `app/.well-known/oauth-authorization-server/route.ts` |
| GET `/.well-known/oauth-protected-resource[/mcp]` | – | resource metadata | `app/.well-known/oauth-protected-resource/**/route.ts` |
| GET `/.well-known/openai-apps-challenge` | – | `OPENAI_APPS_CHALLENGE_TOKEN` | `app/.well-known/openai-apps-challenge/route.ts` |

All paths above are relative to `platform/apps/cloud/`. Session refresh runs in `proxy.ts` (Next 16's
replacement for `middleware.ts`) (`platform/apps/cloud/proxy.ts:4-10`).

Cross-cutting behaviour that matters for integration:

- **Tenant runtime.** `createTenantRuntime(principal)` loads the org policy, decrypts credentials, wraps each provider in `AccountScopedProvider`, and builds `new PolicyEngine(policy, new PostgresPendingStore(principal), new PostgresAuditStore(principal))` before `createContext({… engine, authorizeToolCall, findings: new PostgresFindingsStore(orgId)})` (`platform/apps/cloud/lib/cloud/runtime.ts:44-61,140-146`). Synthetic-reviewer orgs get HTTP 403 (lines 45-47); `includeMock` is never passed, so the cloud runtime has no mock provider. The wiring splits scoped and unscoped providers: the `AccountScopedProvider` goes into `ctx.providers`, but the **unwrapped** provider is handed to `<id>Tools(provider)` (`runtime.ts:72,77,82,86,92,103,108,113,117,126,138`), so provider-namespaced read tools rely solely on `createAccountScopeAuthorizer`, while guarded writes reach the scoped provider via `ctx.providers.get` (`write.ts:44`). With `enforceAccountScope: false` (used only by the OAuth callback) both the wrapper and the authorizer are dropped (`runtime.ts:48-61,144`).
- **Account scope.** The authorizer checks `account_id`/`customer_id` of any tool whose namespace is not `core|mock` against `accountIds[tool.namespace]`; a bridge tool in a new namespace that takes `account_id` would be rejected unless the authorizer is extended (`platform/apps/cloud/lib/cloud/account-scope.ts:36-56`). The enabled set has a second gate: `loadEnabledAccountIds` counts only accounts whose connection is `connected` **and** has `account_selection_id is null` (`repository.ts:618-624`), and `loadProviderCredentials` likewise skips connections awaiting selection (`repository.ts:190-199`), so a provider authorized via OAuth but not yet account-selected is absent from the runtime entirely.
- **Plan gating.** `applyPlanToPrincipal` strips `tools:write` unless `plan.writeAccess && role !== 'viewer'`; the default `reader` plan has `writeAccess:false` and `getOrganizationEntitlement` downgrades to `reader` unless `status` is active/trialing/past_due (`platform/apps/cloud/lib/cloud/plans.ts:23-27,77,93-105`). Every new organization gets an `organization_subscriptions` row with `plan='reader'` from the `on_organization_created_subscription` trigger (`20260828120000_cloud_plans_and_account_scope.sql:61-81`), so a fresh local org cannot create previews via API key/MCP until that row is **updated** to a plan with `writeAccess:true`; until then neither API keys nor session principals carry `tools:write`. Note that `createTenantRuntime` and `ToolRegistry.call` never read `principal.scopes`/`entitlement`: scope and plan are enforced only at the HTTP edges (`requireScope` in `app/api/v1/tools/[tool]/route.ts:11`; the scope filter in `platform/packages/mcp/src/index.ts:122-124`).
- **Error mapping.** Only `/api/v1/*` call `apiError(error)` without a status and so map `AdportError` codes: `POLICY_VIOLATION`→403, `UNKNOWN_TOOL`→404, `PROVIDER_ERROR`→502, `INVALID_INPUT`→400, other (`NOT_CONNECTED`, `PENDING_*`)→409 (`platform/apps/cloud/lib/http.ts:12-22`), plus 401 (bad token) and 429 (rate limit) from `apiPrincipal`. Session routes pass a fixed status to `apiError`, so every error (Zod, missing session, wrong role) is 403 (`/api/onboarding`, `/api/support`: 400 for Zod else 403; `/api/dashboard/summary`: 401 for missing session else 400). `PlanLimitError` always wins with 402 (`http.ts:25`, `lib/cloud/plan-limit.ts:19`). `/mcp` returns `HttpError.status` or 401.
- **CSP and headers.** `connect-src 'self' <supabase origin>`; `font-src 'self' data:`; `style-src 'self' 'unsafe-inline'` (blocks Google Fonts stylesheets as well as font files); `frame-ancestors 'none'` plus `X-Frame-Options: DENY`; `Cache-Control: private, no-store` on `/dashboard*`, `/api/*`, `/mcp`; `output: 'standalone'` when `VERCEL` is unset (`platform/apps/cloud/next.config.ts:12-19,25,49,59-63`). A browser cannot call the engine directly, the dashboard cannot be embedded, and Arabic web fonts must be self-hosted. Server actions (`app/login/actions.ts`, `app/dashboard/actions.ts`, `app/dashboard/billing/actions.ts`) are a third mutation surface outside the route table, with a 1 MB body limit (`next.config.ts:31-35`).
- **i18n state.** `<html lang="en">` with no `dir` (`platform/apps/cloud/app/layout.tsx:11`); `Intl` formatters hard-code `'en'` (`platform/apps/cloud/components/ui.tsx:64-71`); all copy is inline JSX (e.g. `components/nav.tsx:24-39`); one global stylesheet whose font stack is `Inter, ui-sans-serif, …` with no Arabic face (`app/globals.css:20`), dominated by physical direction properties with a single logical `padding-inline`.

### 2.7 Supabase schema (full table list, RLS summary)

Eight migrations under `platform/supabase/migrations/`, applied in filename order; `seed.sql` is a
two-line comment (`platform/supabase/seed.sql:1-2`), so local users are created only through Supabase Auth.
Local ports: API 55321, DB 55322 (the `.env.example` target; the pooler 55329 is never the default), shadow
55320, Studio 55323, mail 55324, analytics 55327; Postgres 17
(`platform/supabase/config.toml:10,35,37,42,47,97,108,390`). The app's pool is `max: 10`, `prepare: false`,
`application_name: 'adport-cloud'` (`platform/apps/cloud/lib/db.ts:7-19`).

A `private` schema is created with usage revoked from `public/anon/authenticated`, and a
`NOLOGIN NOINHERIT` role `adport_backend` is granted to `postgres`
(`20260817171039_cloud_initial_schema.sql:1-11`). The app connects with `SUPABASE_DB_URL` and sets
`role = ADPORT_DB_ROLE` (default `adport_backend`) on every pooled connection (`platform/apps/cloud/lib/db.ts:7-19`).

| Table | Purpose | Migration:line |
| --- | --- | --- |
| `public.profiles` | 1:1 with `auth.users`; written only by trigger | initial:17 |
| `public.organizations` | tenant | initial:24 |
| `public.organization_memberships` | PK (org, user), role enum owner/admin/member/viewer | initial:35 |
| `public.organization_settings` | `policy jsonb` (core DEFAULT_POLICY), `data_retention_days` (default lowered 90→30 at plans:83; the Policies page falls back to 90 only when no row exists, `app/dashboard/policies/page.tsx:22`) | initial:46 |
| `public.connections` | one row per (org, provider); status connected/error/revoked; `account_selection_id`. The provider CHECK here and on `private.provider_credentials`, `private.oauth_transactions`, `public.organization_ad_accounts` lists 6 providers in the initial/plans migrations (initial:56,76,94; plans:20) and is rewritten to 11 by `20260831010651_provider_expansion.sql:3-17` — a new provider id needs all four plus `PROVIDER_IDS`, the `CloudProvider` type, `gatedProviders` and a `runtime.ts` block | initial:53; 20260831152537:2 |
| `private.provider_credentials` | AES-256-GCM ciphertext per connection | initial:73 |
| `private.oauth_transactions` | hashed state + encrypted PKCE verifier, 10-min TTL | initial:90 |
| `public.api_keys` | HMAC digests, scopes ⊆ {tools:read, tools:write} | initial:110 |
| `public.pending_operations` | PolicyEngine pending store (id supplied by app, `operation`/`preview` jsonb, `operation_hash`, `expires_at`, `consumed_at`) | initial:130-148 |
| `public.audit_events` | identity PK, 15-value event CHECK | initial:150-175; plans:165-171 |
| `private.rate_limit_buckets` | 120 req/min buckets | initial:177 |
| `public.deletion_requests` | defined, never written by app code | initial:184 |
| `private.mcp_oauth_clients` / `_authorization_codes` / `_refresh_tokens` / `_access_tokens` | MCP OAuth 2.1 server | 20260825120000:1,16,35,53 |
| `public.organization_subscriptions` | `cloud_plan` enum created as reader/operator/agency/enterprise (plans:1), `premium` added by `20260828140646:1`; Stripe ids; a `reader` row is auto-inserted per organization by trigger (plans:61-81) | plans:3 |
| `public.organization_ad_accounts` | discovered inventory with `enabled` flag | plans:17 |
| `public.findings` | audit findings jsonb, status open/dismissed/applied | plans:33 |
| `private.billing_events` | Stripe webhook idempotency | plans:51 |
| `public.organization_onboarding` | step + completed_at; a `welcome` row is auto-inserted per organization by trigger, existing orgs were back-filled as complete (20260828140646:44-66) | 20260828140646:3 |
| `public.feedback` | support widget | 20260828140646:14 |
| `private.cloud_waitlist` | marketing | 20260831140245:1 |
| `private.provider_account_selections` | encrypted discovery snapshot, 30-min TTL | 20260831152537:4 |
| `private.synthetic_reviewer_workspaces` | admin fixture, referenced by no app code | 20260906132858:2 |

("initial" = `20260817171039_cloud_initial_schema.sql`; "plans" = `20260828120000_cloud_plans_and_account_scope.sql`.)

**RLS summary.** Every public table has RLS on with a `<table>_backend_all` policy for
`adport_backend` (`initial:319-327`, `plans:117-122`, `20260828140646:94-97`) plus narrow
`authenticated` policies that require a membership row: select-only on organizations, settings,
connections, audit_events, deletion_requests, subscriptions, ad_accounts, findings, onboarding;
owner/admin update on settings; self-only on profiles/memberships; feedback select creator-only and insert
for members (`initial:255-317`, `plans:94-115`, `20260828140646:71-92`). `api_keys` and `pending_operations` are
double-locked: table grants revoked from anon/authenticated and a RESTRICTIVE `using(false)` policy
(`initial:300-303,334`). Private tables rely on revokes/grants; three later ones also enable RLS
(`20260831140245:11-17`, `20260831152537:16-20`, `20260906132858:7-14`). Grants to `adport_backend`
were made once with `on all tables` and there is no `ALTER DEFAULT PRIVILEGES` (`initial:335-341`), so
every new table needs explicit grants and policies.

Functions and jobs: `private.handle_new_user` (trigger on `auth.users` insert creates profile,
personal org, owner membership, settings; `initial:220-243`), `private.set_updated_at`,
`private.find_auth_user_id` and `private.organization_member_directory` (security-definer RPCs used by
`lib/cloud/tenant-admin.ts`), `private.create_default_organization_subscription` and
`private.create_default_organization_onboarding` (triggers on `organizations` insert; `plans:61-77`,
`20260828140646:44-60`), `private.apply_data_retention()` (deletes audit_events, pending_operations, findings,
deletion_requests older than `data_retention_days`, and with fixed intervals `private.oauth_transactions`
>1 day, `private.rate_limit_buckets` >1 hour, `private.billing_events` >400 days; `plans:131-163`),
`private.purge_expired_mcp_oauth_records()` (defined, never scheduled and never called from app code, so the
MCP OAuth tables grow unbounded). pg_cron jobs:
`adport-data-retention` at 03:17 daily (`initial:408`) and `adport-account-selection-expiry` every 10
minutes (`20260831152537:22-23`). A plain `postgres` image lacks pg_cron and will fail the first
migration; use the Supabase image or the CLI.

### 2.8 MCP and CLI surfaces, demo mode

**Runtime assembly.** `assembleRuntime({includeMock})` builds a `CredentialStore`, and only when mock is
off runs the 11 `create*Module` factories; `includeMock` falls back to `process.env.ADPORT_DEMO === 'true'`
(`platform/packages/mcp/src/index.ts:44-55`). Demo mode is therefore exclusive: no real provider is loaded
alongside the mock.

**MCP.** `createMcpServer` registers every registry tool only when no `scopes` are given (the stdio server,
`runStdioServer`, `index.ts:219-221`). With `scopes` — which the cloud `/mcp` route always passes as
`principal.scopes` (`apps/cloud/app/mcp/route.ts:51`) — a tool whose required scope (`tools:read` if
`readOnly`, else `tools:write`) is missing is hidden, or registered as a denial stub when `scopeDenials`
provides one (`index.ts:122-124,150-166`); so viewers see no write tools and reader-plan orgs see them only as
`PLAN_LIMIT` error stubs. Registered tools use `inputSchema = tool.input.shape` (`index.ts:138`), an output
schema extended with `_adport` only when the tool has a widget view (`index.ts:139-142`), and
read/destructive/open-world hints. With `productionOnly` it throws `POLICY_VIOLATION` if the runtime is
synthetic, has a non-`PROVIDER_IDS` provider, or any tool is named/namespaced `demo|mock|synthetic`
(`index.ts:88-93`). For tools whose view is `operation` (every non-readOnly tool, `ui.ts:26`) it attaches
`_adport.approval.arguments` when the result (top-level or nested `result`) carries `pending_operation_id` and
the args did not (`index.ts:176-179`); errors return `isError` JSON, with non-`AdportError` exceptions redacted
to `INTERNAL` (`index.ts:185-199`). The stdio binary `adport-mcp` parses `--demo` itself
(`platform/packages/mcp/src/bin.ts:1-5`). The cloud `/mcp` route reuses this adapter with `productionOnly:true`.

**CLI.** Commander program with one global flag `--demo` (`platform/packages/cli/src/program.ts:42-45`).
Commands: `tools list|run`, `accounts`, `report`, `policy`, `audit show|export|run|note`,
`connect <provider>`, `disconnect <provider>`, `recommendations list|apply|dismiss`, `doctor`, `mcp`
(`program.ts:47-396`). `tools run`, `accounts`, `report`, `audit run` and `recommendations *` call
`rt.registry.call(...)` exactly like MCP (`program.ts:86,97,117,196,319,343,356`); `audit show|export|note`
read/append the local `AuditLog` directly (`161,182,214`), `disconnect` uses the local `CredentialStore`
(`301`), `connect` runs per-provider wizards and `doctor` calls `provider.listAccounts()` outside the registry
(`379`), so these have no cloud equivalent. `main` prints `AdportError.toJSON()` to stderr and sets exit
code 1; other errors are rethrown (`program.ts:401-413`).

**Demo data.** `MockProvider` (`id:'mock'`) is in-memory and deterministic: account `mock-1` "Acme DTC
Store" (EUR; `c1` Brand Search 10M micros, `c2` Prospecting 25M, `c4` Legacy Retargeting 8M with zero
conversions) and `mock-2` "Beta App" (USD; `c3` Install Campaign PAUSED 5M)
(`platform/packages/core/src/testing/mock-provider.ts:35-59`). Mock campaign/account state is per process.
What persists across CLI invocations is the pending file, the audit JSONL line, and any findings written by
`audit run` to `${ADPORT_HOME}/findings/<id>.json`, because the audit tools fall back to
`ctx.findings ?? new FindingsStore()` and the CLI never injects `findings`
(`platform/packages/core/src/audit/tools.ts:33,57,77`; `audit/store.ts:19`). A `SyntheticProvider`
(`id:'demo'`) is exported from core but registered by no runtime (§2.2).

**Local state.** `adportHome()` = `$ADPORT_HOME` or `~/.config/adport` (`platform/packages/core/src/paths.ts:8-10`):
`credentials.json` (0600), `pending/<id>.json`, `audit/audit-YYYY-MM.jsonl`, `findings/<id>.json`, `policy.yaml`.

### 2.9 Environment variables

Cloud app (`platform/apps/cloud/lib/env.ts:4-73`): `env()` parses `process.env` with a zod object that strips
unknown keys, so a variable read through `env()` must be declared there. A few places read `process.env`
directly and are not validated: `lib/supabase/proxy.ts:8-9` (the two public Supabase vars),
`next.config.ts:25,37-40` (`VERCEL`, `NEXT_PUBLIC_SUPABASE_URL` for the CSP origin with fallback
`http://127.0.0.1:55321`, `NODE_ENV`) and `app/api/waitlist/route.ts:17,83` (`NODE_ENV`, `VERCEL`).

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase auth clients (`env.ts:5-6`) |
| `SUPABASE_SECRET_KEY` | yes | service-role client, auth admin only (`env.ts:7`) |
| `SUPABASE_DB_URL` | yes | postgres.js pool (`env.ts:8`; example `postgresql://postgres:postgres@127.0.0.1:55322/postgres`, `.env.example:5`) |
| `ADPORT_DB_ROLE` | default `adport_backend` | connection role (`env.ts:9`) |
| `ADPORT_CLOUD_BASE_URL` | yes | OAuth redirects, MCP resource/issuer (`env.ts:10`) |
| `ADPORT_CLOUD_ENCRYPTION_KEY` | yes, ≥40 chars and must base64-decode to exactly 32 bytes (`lib/crypto.ts:5-9`) | AES-256-GCM vault (`env.ts:11`) |
| `ADPORT_API_KEY_PEPPER` | yes, ≥32 | HMAC for `adp_` keys (`env.ts:12`) |
| `ADPORT_MCP_OAUTH_SIGNING_KEY` | yes, ≥40 chars and must base64-decode to exactly 32 bytes (`lib/mcp-oauth.ts:62-66`) | HS256 `at+jwt` MCP access tokens, 1 h, with `iss = ADPORT_CLOUD_BASE_URL` and `aud = ${base}/mcp`; refresh tokens 30 d with a 60 s reuse grace (`mcp-oauth.ts:168-173,190-204`; `lib/cloud/mcp-oauth-repository.ts:17-22`). Changing `ADPORT_CLOUD_BASE_URL` invalidates every issued token (`env.ts:14`) |
| `STRIPE_*` (secret, webhook, 6 price ids) | optional | billing (`env.ts:15-22`) |
| `RESEND_API_KEY`, `SUPPORT_NOTIFICATION_EMAIL` | optional | support emails (`env.ts:23-24`) |
| `OPENAI_APPS_CHALLENGE_TOKEN` | optional | domain verification (`env.ts:26`) |
| `GOOGLE_ADS_CLIENT_ID/SECRET/LOGIN_CUSTOMER_ID`, `GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_OAUTH_REVOKE_URL` (the last two default to Google's endpoints and are absent from `.env.example`, `env.ts:31-32`), `META_*`, `TIKTOK_APP_ID/SECRET`, `MICROSOFT_ADS_*`, `REDDIT_*`, `APPLE_ADS_*` | optional | Adport-owned OAuth apps (`env.ts:28-53`) |
| `ADPORT_PROVIDER_TEST_ORGANIZATION_IDS` | optional, three-state | gates snapchat/spotify/pinterest/linkedin/x: **unset** = allowed for every org; non-empty = only the listed org UUIDs; **empty string (the `.env.example:83` default) = denied for all** (`lib/cloud/provider-rollout.ts:9-16`; synthetic-reviewer orgs always denied, line 10). Enforced at runtime assembly (a stored credential is silently not loaded, `runtime.ts:69-93`), OAuth start/callback (`start/route.ts:32`, `callback/route.ts:63`) and connection cards (`lib/cloud/provider-oauth.ts:407-409`). Copying `.env.example` verbatim disables Snapchat (`env.ts:56`) |
| `ADPORT_SYNTHETIC_REVIEWER_ORGANIZATION_IDS` | optional | orgs blocked with 403 (`env.ts:57`) |
| `{SNAPCHAT,SPOTIFY,PINTEREST,LINKEDIN}_CLIENT_ID/_CLIENT_SECRET/_OAUTH_ENABLED`, `X_CONSUMER_KEY/SECRET`, `X_OAUTH_ENABLED` | optional, `_OAUTH_ENABLED` default `'false'` | extra providers (`env.ts:58-72`) |

Core / CLI / MCP: `ADPORT_HOME` (`paths.ts:9`), `ADPORT_POLICY` (`policy.ts:41`), `ADPORT_DEMO`
(`mcp/src/index.ts:47`). Provider BYO fallbacks for the local runtime: `TIKTOK_ACCESS_TOKEN/APP_ID/APP_SECRET/SANDBOX`
(`platform/packages/tiktok/src/index.ts:22-30`), `SNAPCHAT_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN`
(`platform/packages/snapchat/src/index.ts:20-22`), and analogous sets for the other providers.

---

## 3. paid-media-agent (engine/)

### 3.1 Self-hosted API endpoints (full endpoint table)

One FastAPI app built by `create_app(runtime)` (`engine/src/paid_media_agent/surfaces/api/app.py:39-168`),
started by `paid-media-agent serve [--host H] [--port P]` (`engine/src/paid_media_agent/cli.py:556-582`; the
flags override `PAID_MEDIA_API_HOST`/`PAID_MEDIA_API_PORT`, lines 557-565; contract tests instantiate
`create_app` directly), bound to `PAID_MEDIA_API_HOST:PAID_MEDIA_API_PORT` (defaults `127.0.0.1:8080`,
`config.py:175-176`). There is no CORS
middleware anywhere in `engine/src` (grep for `cors` is empty) and FastAPI's default `/docs` and
`/openapi.json` are not disabled (`app.py:51`).

| Method / path | Auth | Body → response | Lines |
| --- | --- | --- | --- |
| GET `/health` | none (discloses `catalog_revision` and `writes_enabled` unauthenticated) | `{status, persistence: postgres\|memory, catalog_revision, catalog_source, selection, writes_enabled}` | `app.py:80-89` |
| POST `/threads/{thread_id}/messages` | Bearer | `{text: 1..8000}` → `OutcomeView`; 403 if thread owned by another caller | `app.py:91-101` |
| GET `/proposals/{proposal_id}` | Bearer; requester or approver | `{proposal: ProposalView, receipt: ReceiptView\|null}`; 404 unknown, 403 otherwise | `app.py:103-114` |
| POST `/proposals/{proposal_id}/approve` | Bearer; caller must be in `approver_refs` and ≠ requester unless self-approval is allowed | no body → `OutcomeView`. Signs and stores a claim first (`writes.py:513-551`), then resumes the thread **as the requester** only if the graph is interrupted; otherwise returns the unchanged outcome and the claim sits unused until its TTL (`runner.py:224-227,242-255`). 403 for any `WriteDenied` from `approve`: `approver_policy`, `unknown_proposal`, `not_awaiting_approval`, `digest_mismatch`, `proposal_changed` | `app.py:116-124` |
| POST `/proposals/{proposal_id}/reject` | Bearer (no identity check) | `{message ≤500}` → `OutcomeView`. 409 only for `WriteDenied`: `unknown_proposal` (`runner.py:265-267`) or the optimistic-save conflict `proposal_changed` (`writes.py:553-555`). Rejecting a proposal that is not in `awaiting_approval\|proposed\|revised` raises an **uncaught** `InvalidTransition` (plain `Exception`; `writes.py:498-500`, `domain/proposals.py:50-52,62-74`; no handler in `app.py`) → HTTP 500. Check `state` via GET first | `app.py:126-138` |
| POST `/proposals/{proposal_id}/edit` | Bearer (no identity check) | `{changes}` must contain **exactly** the originally proposed fields, each in `editable_fields` (`writes.py:355-357,470-472`) → `{proposal}` with `revision+1`, a **new** `routing_id` and refreshed `catalog_revision`/`schema_hash`/`policy_digest` (`writes.py:474-494`); 409 on `WriteDenied` (`not_awaiting_approval` from `runner.py:283-284`, `field_not_editable`, `schema_validation_failed`, `proposal_changed`). Does not resume the thread (`runner.py:277-286`); the pending `execute_change` interrupt remains and a later `/approve` executes the new revision (`write_tools.py:170-182`) | `app.py:140-148` |
| GET `/threads/{thread_id}/artifacts/{name}` | Bearer, thread owner (403 before 404) | 400 for names containing `/`, `\\` or starting with `.`; bytes of `workspace/out/<name>` only if a `render_report` ToolMessage in that thread references it; `.html/.pdf/.json` ≤15 MiB only (`reports/bridge.py:10-15`) | `app.py:150-166` |
| POST `/slack/events` | Slack signature | registered only when `SLACK_TRANSPORT=http` + signing secret + bot token | `app.py:64-78` |

`OutcomeView = {version:'presentation/1', thread_id, text, interrupted, proposal, receipt, available_actions}`;
`available_actions` is `("approve","edit","reject")` only when interrupted and `proposal.state == 'awaiting_approval'`
(`engine/src/paid_media_agent/surfaces/api/views.py:11-38`). `proposal` is simply the newest record on the
thread (`runner.py:91-93,134`), which can be an earlier rejected one; `interrupted` is `bool(snapshot.interrupts)`
(`runner.py:128-129`) and the interrupt is attached only to `execute_change`, not `propose_change`
(`assembly.py:256-258`), so a turn in which the model proposed but did not call `execute_change` returns
`proposal.state == "awaiting_approval"` with `interrupted=false` and `available_actions=[]`. The message call is
synchronous: with no event handler `AgentRunner._run` uses `graph.ainvoke` (`surfaces/runner.py:150-154`). Each
model call is bounded by `PAID_MEDIA_MODEL_TIMEOUT_SECONDS` (120 s) and may be retried up to 2 times by
`ModelRetryMiddleware` on top of the SDK's own `max_retries=2` (`assembly.py:73,166,239-241`); the run ends after
`PAID_MEDIA_MAX_MODEL_CALLS` (40) calls (`assembly.py:242-244`). Tool execution time (provider calls up to 60 s,
mutation 30 s, readback 20 s) is outside these limits, so there is no fixed upper bound on a request's duration.
When interrupted and a proposal exists on the thread, `text` is the last assistant prose (≤2000 chars) followed by
"A change is waiting for review." (`runner.py:62-67,139-141`).

There is **no endpoint that triggers a report** and no listing endpoint for threads, proposals or artifacts.

### 3.2 Authentication

`PAID_MEDIA_API_TOKENS` is a comma-separated list of `token:caller_ref` pairs parsed by
`Settings.api_token_map()` with `partition(':')`; malformed pairs are dropped silently
(`engine/src/paid_media_agent/config.py:258-267`). `resolve_caller` requires `Authorization: Bearer …`
(case-insensitive scheme) and compares against each configured token with `hmac.compare_digest`;
tokens are plaintext in `.env`, nothing is hashed (`app.py:28-36`). The `caller` dependency returns 503
when no tokens are configured and 401 on mismatch (`app.py:53-59`).

The `caller_ref` is the identity for everything else:

- **Thread ownership** — first caller to use a `thread_id` owns it forever (`runner.py:86-89`; Postgres `pma_thread_owners`, `persistence/postgres.py:39-42`).
- **Approvals** — `ApprovalPolicy.may_approve` requires the approver to be in `PAID_MEDIA_APPROVER_IDS` and forbids self-approval unless `PAID_MEDIA_ALLOW_SELF_APPROVAL` (`tools/writes.py:129-141`; `config.py:163,166`). With the list empty nobody can approve over the API: `configured_profile` builds the policy with `approval_policy_from_settings(settings)` and no `default_approvers` (`runtime/mda.py:62`; definition at `runtime/profiles.py:112-120`), overriding `fixture_profile`'s `{"local-user"}` default (`profiles.py:150-151`); `serve` reaches it via `build_self_hosted_runtime` (`runtime/self_hosted.py:72`).
- **Approval claims** are HMAC-SHA256 signed with `PAID_MEDIA_APPROVAL_SIGNING_KEY` (≥16 bytes or construction raises) or an ephemeral per-process key, so unset means claims do not survive a restart (`writes.py:144-160`; `profiles.py:104-109`).

The admin "setup console" (`paid-media-agent setup`, `admin/server.py`) is a separate localhost-only
FastAPI app with its own `X-Admin-Token`; it is not part of the API surface.

### 3.3 Proposal and approval format

The model has exactly four write-related tools: `discover_write_operations`, `propose_change`,
`execute_change`, `get_proposal` (`engine/src/paid_media_agent/assembly.py:67-72`; names at
`tools/writes.py:62-65`; built at `tools/write_tools.py:206-236`). Every provider mutation in the catalog is
classified `MUTATION` or `DENIED`, and mutations are never bound as LangChain tools (`build_platform_read_tools`
binds only `catalog.read_entries()`, `tools/reads.py:347-360`), so a direct call to one is denied by
`InvocationGuardMiddleware` as `outside_tool_surface` ("tool is not part of the authorized surface; use
discover_tools", `middleware/authorization.py:80-85`). The second check, "provider mutations run only through
propose_change and execute_change" (`authorization.py:86-92`), is a backstop for a bound name whose catalog class
changed after assembly.

**`ProposalView`** (what the API returns, `domain/presentation.py:22-69`):

| Field | Meaning |
| --- | --- |
| `version` | always `"presentation/1"` (`presentation.py:19,27`) |
| `proposal_id` (UUID, stable), `revision` (≥1, +1 per edit) | identity |
| `routing_id` | opaque per-revision token for surfaces (Slack button routing); regenerated by `secrets.token_urlsafe(18)` on every `/edit` (`tools/writes.py:445,493`; `UNIQUE` column, `persistence/postgres.py:14`) — never key on it |
| `state` | `draft, proposed, awaiting_approval, revised, executing, verifying, verified, rejected, failed, unknown` (`domain/proposals.py:19-29`) |
| `platform` | engine `Platform` enum (`google_ads`, `meta_ads`, `reddit_ads`, `tiktok_ads`, `pinterest_ads`, `snap_ads`, `google_analytics`, `linkedin_ads`, `x_ads`, `openai_ads`) |
| `account_ref` | the engine **alias** (never the provider account id) |
| `tool_name` | `<platform>__<op>`, e.g. `google_ads__update_campaign_budget` |
| `target_ref` | provider entity id passed as the operation's `target_arg` (`tools/write_tools.py:35-37`; `tools/write_policy.py:29`; `writes.py:362-366`); a campaign id for every row in the shipped policy (`config/write-policy.example.toml:20,31,40,50,58,68`) |
| `before[]`, `after[]` | `FieldValue {field, value, unit}` |
| `reason`, `measurement_plan`, `reversal_plan` | prose |
| `risk`, `risk_flags[]` | `low\|medium\|high`; flags such as `budget_increase`, `status_flip` |
| `payload_digest`, `catalog_revision`, `requester_ref` | binding |

`ProposalView` does **not** expose `canonical_args` (where the provider account id lives, `writes.py:362-366`),
`thread_id`, `schema_hash` or `policy_digest` (`presentation.py:47-69` vs `domain/proposals.py:85-131`), so
`GET /proposals/{id}` returns no thread id; a bridge must remember thread↔proposal from the `/messages`
`OutcomeView`. `ReceiptView` (returned by `/approve`, `/reject`, `/messages` and `GET /proposals/{id}`) is
`{version, proposal_id, revision, status: verified|rejected|failed|unknown, mutation_attempted,
provider_acknowledged, verified_state[], checked_at, reason, readback_attempts}` (`presentation.py:72-98`;
statuses `proposals.py:16`); `WriteReceipt.provider_operation_ref`/`catalog_revision` are not exposed
(`proposals.py:184-198`).

The persisted object is `ProposalRecord {changeset, state, history[], routing_id}` (`domain/proposals.py:201-210`),
stored whole as `pma_proposals.record` (`persistence/postgres.py:76-83`); its `changeset: ChangeSet`
(`proposals.py:85-131`) is the canonical, digest-bound payload whose `payload_digest` is sha256 over canonical
JSON of the binding fields (prose excluded). `ApprovalClaim`
(`domain/proposals.py:148-181`) binds `claim_id, proposal_id, revision, payload_digest, account_ref,
tool_name, requester_ref, approver_ref, approved_at, expires_at, nonce` under one HMAC signature; claims
are single-use (`pma_approvals.used_at`).

**Lifecycle through the API.** The model calls `propose_change` (persists at `awaiting_approval`) then
`execute_change`, which is under LangGraph human-in-the-loop: `build_execute_interrupt` returns
`InterruptOnConfig(allowed_decisions=["approve","reject"], when=<proposal belongs to this thread>)`
(`tools/write_tools.py:82-114`; wired at `assembly.py:256-258`, passed to `create_deep_agent(interrupt_on=…)`
at `runtime/local.py:63-82`). The API returns `interrupted=true`. `POST /approve` → `ProposalService.approve`
signs a claim, then `AgentRunner.resume` sends `Command(resume={"decisions":[{"type":"approve"}]})` as the
original requester (`runner.py:242-255`). On resume, `_execute` finds the host claim and calls
`WriteExecutor.execute` (`write_tools.py:151-185`), which re-verifies claim signature/revision/digest/scope/expiry,
re-validates the catalog, runs `WriteGate.check` (`writes.py:790-793`), then makes **at most two**
`call_mutation` calls, each under a 30 s timeout (`DEFAULT_MUTATION_TIMEOUT_SECONDS`, `writes.py:70`): a
provider-side validation pass with `{**arguments, <validate_only_arg>: True}` when the policy row sets
`validate_only_arg` (`writes.py:816-839`; set on every budget row of `config/write-policy.example.toml:25,45,63`
and in `fixture_write_policy`, `tools/write_policy.py:180`), then the single live mutation with the optional
idempotency key (`writes.py:840-851`), followed by bounded readback (3 attempts / 20 s, `writes.py:67-68,707-761`)
into a `WriteReceipt`. Outcomes: a `WriteDenied` from claim/catalog/gate verification marks the proposal
`rejected` and stores a `rejected` receipt (`writes.py:794-803`); an approval replay marks it `failed` but
returns a `rejected` receipt (`810-814`); a provider validation refusal marks `failed`/`failed` with
`mutation_attempted=False` (`824-839`); a provider error → `failed` (`857-870`); readback still equal to the
before value → `failed` (`890-904`); inconclusive readback → `unknown` (`905-918`); a timeout after submission
continues into readback (`855-856`). `unknown_proposal`/`not_awaiting_approval`/`approval_required` raise
`WriteDenied` with no receipt and no state change (`775-789`), and re-executing a finished revision returns its
stored receipt (`781-783`).

One path exists by which a `POST /threads/{id}/messages` call alone could execute a write: when the graph resumes
and **no** host-made claim exists for the current revision, `_execute` calls `service.approve(pid,
approver_ref=<calling caller_ref>)` itself (`tools/write_tools.py:170-181`). `ApprovalPolicy.may_approve`
refuses this unless that caller_ref is in `PAID_MEDIA_APPROVER_IDS` **and** (being also the requester)
`PAID_MEDIA_ALLOW_SELF_APPROVAL=true` (`writes.py:136-141`).

### 3.4 How it connects to ad platforms

Two mechanisms, both host-side; the model never holds a credential, and provider account ids are kept out of
tool **inputs** (aliases are injected host-side and raw ids in arguments are rejected, `tools/reads.py:176-181`).
Provider **results** are not scrubbed: a non-normalized read returns the raw `provider_result` payload to the model
as a 1200-char preview (`reads.py:313,340-344`) and in full via the `analysis/art_*.json` artifact
(`reads.py:303-312`), and `RedactionMiddleware` covers only configured secrets and credential-shaped regexes
(`middleware/redaction.py:16-28`).

1. **Pipeboard MCP.** `PIPEBOARD_API_TOKEN` plus eight endpoint URLs defaulting to `https://<platform-with-hyphens>.mcp.pipeboard.co/` (`google-ads`, `meta-ads`, `reddit-ads`, `tiktok-ads`, `pinterest-ads`, `snap-ads`, `google-analytics`, `linkedin-ads` — not the underscored `Platform` values) keyed by google_ads, meta_ads, reddit_ads, tiktok_ads, pinterest_ads, snap_ads, google_analytics, linkedin_ads (`config.py:139-147,232-242`). `PipeboardCatalogLoader.refresh()` loads tools via `langchain_mcp_adapters.MultiServerMCPClient` over Streamable HTTP once per process (`tools/pipeboard.py:95-99`; constructed once in `load_catalog`, `runtime/catalog.py:99-102`); each endpoint has a 20 s timeout and a failure is logged and yields no tools for that platform (`pipeboard.py:33,111-121`). The **only live write adapter** is `PipeboardWriteProvider.call_mutation`, which refuses any tool whose `read_only_hint is not False` (`tools/pipeboard.py:196-217`); `WriteProvider` is a Protocol "never bound to the model" (`tools/providers.py:38-46`).
2. **Direct read-only adapters** for X Ads (OAuth 1.0a, `https://ads-api.x.com/12`) and OpenAI Ads (`https://api.ads.openai.com/v1`), enabled when their keys are set (`config.py:150-154,244-256`). They publish no mutations.

`load_catalog` picks the source (`runtime/catalog.py:39-108`): `PAID_MEDIA_DATA_MODE=sample` → fixture
catalog, `write_provider=None`; no Pipeboard token and no direct keys → fixture (or `ValueError` in `live`);
direct keys only → `fixture+direct`/`direct`, still `write_provider=None`; Pipeboard token → live catalog,
`PipeboardWriteProvider`, admitted mutations taken from the write-policy TOML. `configured_profile`
(`runtime/mda.py:47-74`) starts from `fixture_profile` (default `FakeWriteProvider`, `write_provider_is_fake=True`;
`runtime/profiles.py:131,147-148`), always replaces `write_policy` with the TOML-validated policy (`mda.py:56,64`),
replaces the `read_provider` whenever `load_catalog` returned one — including the direct-only, non-live case
(`mda.py:65-66`) — and replaces the `write_provider` with `write_provider_is_fake=False` only when `loaded.live`
(`mda.py:67-73`). With direct keys but no Pipeboard token the profile therefore pairs a fresh
`CompositeReadProvider(FixtureReadProvider(), …)` (`catalog.py:84`; new `FixtureState`, `tools/fixtures.py:344-345`)
with the fixture-profile `FakeWriteProvider` over a *separate* `FixtureState` (`profiles.py:138,147`): reads are
live/direct, writes hit the in-memory fake, and fixture reads do not see fake writes.

Accounts are aliases: `config/accounts.example.toml` maps `demo-google`/`demo-meta`/`demo-reddit` to fixture
account ids; `ReadDispatcher` replaces the provider account argument with `account_alias` in model-facing
schemas and rejects raw provider ids. Normalized `PerformanceRow`s are produced only when the platform is in
`PERFORMANCE_PLATFORMS` = google_ads, meta_ads, reddit_ads, linkedin_ads, x_ads, openai_ads
(`tools/normalize.py:14-27`) **and** the provider payload carries a non-empty top-level `rows` list
(`tools/reads.py:240-241`); any other read, including one from a performance platform, is stored as a raw
`provider_result` artifact (`reads.py:303-330`), a row lacking date/spend/entity id fails as
`ReadDenied("normalization_failed")` (`normalize.py:106-121`; `reads.py:256-257`), and `run_cadence_report`
treats such a read as unavailable (`reports/cadence.py:112-114`). TikTok, Pinterest, Snap and GA4 can never
normalize (`normalize.py:95-97`). Note `snap_ads` is known to the
engine but has no fixture data, no normalization and no admitted writes.

### 3.5 Reporting pipeline and demo mode

Two report paths share one renderer.

- **Deterministic CLI path.** `paid-media-agent report --cadence weekly|monthly [--end] [--alias]* [--no-render] [--json]` (`cli.py:465-550`) → `run_cadence_report` (`reports/cadence.py:64-78`): for every alias it looks up a tool literally named `get_campaign_performance` (`cadence.py:26`), reads the union window, runs `run_compare_periods`, and unless `--no-render` calls `run_render_report` with a code-written title/summary (`cadence.py:130-144`). No model call is made, but `build_configured_runtime` still constructs the chat model object via `init_chat_model`. Verified to exit 0 with no provider keys and produce HTML + PDF — but with the default `--end` (yesterday, `cli.py:469-471,492`) and the default fixture anchor (today−2, `tools/fixtures.py:201-214`) every platform is flagged `incomplete_window` (`tools/reads.py:263-264`) and the cross-platform total is suppressed with "at least one platform window is incomplete" (`tools/compute.py:319-322`). Pass `--end <today-2>` for a clean fixture report (reddit is complete only through today−4 because the shift preserves shipped lags, `fixtures.py:217-232`). The command exits 1 when no alias produced `performance_rows` (`cadence.py:116-117`; `cli.py:509-511`) or when the comparison does not reconcile (`cli.py:549-550`).
- **Model path.** The `render_report` tool (`tools/reports.py:36-76`) validates an `analysis` artifact, builds and reconciles a `ReportPayload`, renders Jinja2 `report.html.j2` to `<workspace>/out/rpt_<12hex>.html` (+ `.pdf` when WeasyPrint imports), validates via `ArtifactBridge` (`.html/.pdf/.json`, 1 B..15 MiB, no symlinks, inside `out/`; `reports/bridge.py:10-54`), and writes the payload as `out/art_<16hex>.json` (`tools/artifacts.py:17-26`).

Only files referenced by a successful `render_report` ToolMessage in a thread's checkpoint are
downloadable, and only by the thread owner (`runner.py:95-123`; `app.py:150-166`). **CLI-generated reports
are not reachable through the API.** Charts are inline SVG from the template, not Pillow.

**Demo.** `paid-media-agent demo [--with-proposal]` forces `PAID_MEDIA_MODEL=scripted:demo`, sample
data mode, the example accounts file and self-approval, and drives the real graph with a
`ScriptedChatModel`; `--with-proposal` proposes `google_ads__update_campaign_budget` on `g-103` to 240,
approves via `ProposalService.approve`, resumes and requires a `verified` receipt
(`cli.py:89-119`; `testing/demo_script.py:204-286`). It writes only `workspace/analysis/art_*.json`
(no HTML). The scripted model is **not** constructible by `init_chat_model`, so the self-hosted API has no
demo mode: `serve` on fixture data still needs a real model key to answer a message (`cli.py:559-582` →
`runtime/self_hosted.py:65-92` passes `model=None` → `assembly.py:190-195`). The only HTTP surface that runs
the scripted demo is the local setup console's "Run demo" action (`paid-media-agent setup`, `cli.py:57-83`;
`admin/routes.py:104-110`; `admin/actions.py:981-1005`), an operator tool, not the chat API.
`build_self_hosted_runtime` does accept a `model` override (`self_hosted.py:69`) that `serve` never passes, so a
programmatic bridge could inject `ScriptedChatModel` even though the CLI cannot.

Fixture datasets (`src/paid_media_agent/fixtures/data/*.json`) ship for google/meta/reddit with
`data_complete_through 2026-08-28` (reddit `2026-08-26`, no `value` field) and are date-shifted so the
newest complete day is `PAID_MEDIA_FIXTURE_ANCHOR` or today−2.

### 3.6 Agent assembly and middleware

`build_agent_components` (`assembly.py:179-290`) resolves `PAID_MEDIA_MODEL` as `provider:model` through
`init_chat_model` with SDK `timeout` and `max_retries=2` (`assembly.py:164-171`; default
`anthropic:claude-sonnet-4-6`), binds `CORE_TOOLS` (`list_accounts`, `discover_tools`, `compare_periods`,
`summarize_window`, `render_report`; `assembly.py:60-66`), `WRITE_TOOLS` (four, above; `assembly.py:67-72`) and
one StructuredTool per READ catalog entry via `build_platform_read_tools` (`assembly.py:200`;
`tools/reads.py:347-391`). Filesystem tools `ls, read_file, write_file, edit_file, glob, grep` come from Deep
Agents (`assembly.py:59`). Only platform read tools are searchable;
core/write/filesystem tools are always included (`assembly.py:224-233`).

Middleware order (`assembly.py:246-255`): `ModelRetry(2)` → `ModelTimeout` → `ModelCallLimit(40)` (all
omitted for `scripted:`) → `CurrentDate` → tool selection → `InvocationGuard` (hides `task/execute/delete`,
denies any call outside the bound surface and non-READ catalog calls) → `ResultOffload` (string results longer
than `PAID_MEDIA_RESULT_OFFLOAD_CHARS`=6000 become `tool_result` artifacts, except the paged filesystem tools
`read_file, ls, glob, grep, edit_file, write_file`, which are never offloaded; `middleware/offload.py:18-19,36`) →
`Redaction` (secret values + regexes; X/OpenAI Ads keys are not in the explicit list). Tool selection is
`ProviderToolSearchMiddleware` only when the exact `PAID_MEDIA_MODEL` string is in `CAPABILITY_REGISTRY` with
`native_tool_search=True` (the listed Anthropic and OpenAI ids; an unlisted alias falls through,
`middleware/tool_selection.py:91-115,135-137`) and no `PAID_MEDIA_MODEL_BASE_URL` is set; otherwise
`PortableToolSelectorMiddleware` (max `PAID_MEDIA_MAX_SELECTED_TOOLS`, selector = `PAID_MEDIA_TOOL_SELECTOR_MODEL`
or the main model, wrapped in `LenientStructuredOutputModel` for `langsmith:` specs; `tool_selection.py:149-177,
265-269`; `assembly.py:213-223`); no selection middleware for `scripted:` or when the catalog has no read tools
(`tool_selection.py:279-280`).
`interrupt_on[execute_change]` is attached (`assembly.py:256-258`) and the system prompt is
`<project_root>/instructions.md` (empty string if missing, `assembly.py:260-264`) with skills at `/skills/`.
`compile_graph` (`runtime/local.py:63-82`) calls `deepagents.create_deep_agent` with
`FilesystemBackend(root_dir=project_root, virtual_mode=True)` (line 78) and `permissions=filesystem_permissions()`
(line 77), whose rules (`runtime/local.py:28-50`) deny read/write on `/.env`, `/.env.*`, `/.venv/**`, `/.git/**`,
`/.mda/**`, `/.agents/**`, `/.claude/**`, `/config/**`, `/workspace/sources/**`, `/docs/org/**`, deny writes to
`/workspace/skills/**`, allow writes under `/workspace/**`, and deny all other writes. `agent.py`
(`engine/agent.py:12-21`) hands only `model`, `tools`, `middleware` and `interrupt_on` from the same components to
`managed_deepagents.define_deep_agent` — not the assembled `system_prompt` or `skills` (`AgentComponents` fields,
`assembly.py:96-97`), which `compile_graph` does pass (`local.py:74,76`); MDA reads `instructions.md`/`skills/`
itself. This monorepo does not use the MDA path.

### 3.7 Persistence

`build_self_hosted_runtime` (`runtime/self_hosted.py:65-105`): with `DATABASE_URL`,
`PostgresRepositories(url).setup()` runs idempotent `CREATE TABLE IF NOT EXISTS` over a sync psycopg pool
(min 1 / max 4) and `AsyncPostgresSaver.setup()` on a separate async pool creates LangGraph's checkpoint
tables (`self_hosted.py:45-62`). Without it everything is in memory (`InMemory*` repositories,
`InMemorySaver`) and `/health` reports `"memory"`; threads, proposals and ownership vanish on restart.

| Table | Columns | Source |
| --- | --- | --- |
| `pma_proposals` | `proposal_id UUID PK, routing_id TEXT UNIQUE, thread_id, state, record JSONB, updated_at`; optimistic update compares the whole prior record JSON | `persistence/postgres.py:12-20` |
| `pma_approvals` | `claim_id UUID PK, proposal_id, revision, approved_at, used_at NULL, claim JSONB`; `mark_used` sets `used_at` once | `postgres.py:21-29` |
| `pma_receipts` | `proposal_id UUID PK, receipt JSONB, created_at`; upserted `ON CONFLICT (proposal_id) DO UPDATE`, so only the latest revision's receipt survives (`postgres.py:195-196`) | `postgres.py:30-34` |
| `pma_dedupe` | `dedupe_key TEXT PK, seen_at` (Slack events) | `postgres.py:35-38` |
| `pma_thread_owners` | `thread_id TEXT PK, caller_ref` | `postgres.py:39-42` |
| `checkpoint_migrations`, `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` | LangGraph (third-party DDL) | `langgraph-checkpoint-postgres` |

Artifacts live on disk under `PAID_MEDIA_WORKSPACE_ROOT` (default `workspace/` relative to `project_root`,
which is `/app` in the image): `analysis/art_*.json` for reads/analyses, `out/` for reports
(`tools/artifacts.py:20-26`). The compose file mounts `workspace` as a named volume and `./config`,
`./workspace/skills` read-only (`engine/docker-compose.yml:12-15`).

### 3.8 Environment variables

Read by pydantic-settings from the environment plus a `.env` file (`engine/src/paid_media_agent/config.py:111`):
`serve`/`slack` call `Settings()` and read `.env` from the CWD (`cli.py:561`), while the other CLI commands use
`actions.load_settings(root)`, which exports the project-root `.env` into the process and reads it explicitly
(`admin/actions.py:95-98`). Blank strings become `None` only for the 17 fields named in the two `mode="before"`
validators (`config.py:178-211`: fixture anchor, model base URL, tool-selector model, api-key-env, live-write
catalog revision, and the twelve `SecretStr` fields); every other blank value is kept as-is or fails validation
— e.g. `PAID_MEDIA_APPROVER_IDS=` stays `""` (`163`), `PAID_MEDIA_API_HOST=` binds to `""` (`175`),
`PAID_MEDIA_WORKSPACE_ROOT=` becomes `Path("")` (`131`), and `PAID_MEDIA_MODEL_TIMEOUT_SECONDS=` aborts
startup (`118`). Every key below appears in `engine/.env.example`.

| Variable | Default | Role |
| --- | --- | --- |
| `PAID_MEDIA_MODEL` | `anthropic:claude-sonnet-4-6` | model spec (`provider:model`) |
| `PAID_MEDIA_MODEL_BASE_URL`, `PAID_MEDIA_TOOL_SELECTOR_MODEL`, `PAID_MEDIA_MODEL_API_KEY_ENV` | none | optional model routing |
| `PAID_MEDIA_MODEL_TIMEOUT_SECONDS` / `PAID_MEDIA_MAX_MODEL_CALLS` | 120 / 40 | per-call timeout, calls per run |
| `PAID_MEDIA_RUNTIME` | `local` | doctor/console/`test all` only (`doctor.py:215`; `cli.py:376`); `serve` always builds `self_hosted` |
| `PAID_MEDIA_LOG_LEVEL` | `INFO` | root logging level for every CLI command including `serve` (`config.py:130`; `cli.py:23-26,566`; `.env.example:16`) |
| `PAID_MEDIA_DATA_MODE` | `auto` | `sample` forces fixtures; `live` requires credentials |
| `PAID_MEDIA_WORKSPACE_ROOT` | `workspace` | artifacts/report root |
| `PAID_MEDIA_FIXTURE_ANCHOR` | today−2 | last complete fixture day |
| `PAID_MEDIA_ACCOUNT_CONFIG_PATH` | `config/accounts.example.toml` | alias registry; relative paths resolve against `project_root`, not CWD; ignored (forced to the example file) when `PAID_MEDIA_DATA_MODE=sample`; a missing file yields an empty registry **silently**, after which every `propose_change` fails `unknown_account_alias` (`runtime/profiles.py:72-82`; `tools/writes.py:346-348`) |
| `PAID_MEDIA_MAX_SELECTED_TOOLS` / `PAID_MEDIA_RESULT_OFFLOAD_CHARS` | 6 / 6000 | selection budget, offload threshold |
| `PIPEBOARD_API_TOKEN` | none | enables live Pipeboard catalog + write provider |
| `PIPEBOARD_{GOOGLE_ADS,META_ADS,REDDIT_ADS,TIKTOK_ADS,PINTEREST_ADS,SNAP_ADS,GOOGLE_ANALYTICS,LINKEDIN_ADS}_MCP_URL` | `https://<platform-with-hyphens>.mcp.pipeboard.co/` (e.g. `google-ads`, `google-analytics`; `config.py:140-147`) | MCP endpoints |
| `X_ADS_CONSUMER_KEY/SECRET`, `X_ADS_ACCESS_TOKEN/_SECRET`, `OPENAI_ADS_API_KEY` | none | direct read-only adapters |
| `PAID_MEDIA_WRITES_ENABLED` | `false` | global live-write flag (`WriteGate`) |
| `PAID_MEDIA_WRITE_POLICY_PATH` | `config/write-policy.example.toml` | admitted mutations |
| `PAID_MEDIA_KILL_SWITCH_PATH` | `workspace/KILL_SWITCH` | file presence refuses every execution, fakes included |
| `PAID_MEDIA_LIVE_WRITE_CATALOG_REVISION`, `PAID_MEDIA_LIVE_WRITE_CANARY_TOOLS` | unset / `''` | live-write release pins |
| `PAID_MEDIA_APPROVER_IDS` | `''` | approver caller_refs |
| `PAID_MEDIA_APPROVAL_SIGNING_KEY` | none (ephemeral) | claim HMAC key, ≥16 bytes |
| `PAID_MEDIA_APPROVAL_TTL_SECONDS` / `PAID_MEDIA_ALLOW_SELF_APPROVAL` | 900 / `false` | claim lifetime, self-approval |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_TRANSPORT` | none / `socket_mode` | Slack adapter |
| `DATABASE_URL` | none | enables Postgres repositories + checkpointer |
| `PAID_MEDIA_API_TOKENS` | none | `token:caller,…`; unset → 503 on protected routes |
| `PAID_MEDIA_API_HOST` / `PAID_MEDIA_API_PORT` | `127.0.0.1` / 8080 | bind (Dockerfile sets `0.0.0.0`) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, … | none | read by provider SDKs, not by `Settings` |
| `PAID_MEDIA_SLACK_*`, `PAID_MEDIA_REPORT_TIME/TIMEZONE`, `PAID_MEDIA_WEEKLY/MONTHLY_REPORT_DAY`, `PAID_MEDIA_SANDBOX_*` | various | MDA deployment only (schedules, channel, sandbox); not in `Settings` except the two `paid_media_sandbox_*` fields (`config.py:126-128`), otherwise only in deployment tests and `OPERATIONS.md` (`tests/unit/test_deployment.py:35-43`; `OPERATIONS.md:87-107`); unused by `serve` |
| `LANGSMITH_API_KEY` | none | LangSmith tracing, the LangSmith model gateway (a `langsmith:` or bare `provider/model` spec, `config.py:24,43-44`, built through `init_chat_model`, `assembly.py:164-171`), sandboxes and `mda deploy` (`.env.example:31-33,91-93`; checked by `doctor.py:32`); relevant to `serve` when tracing or a gateway model is used |
| `LANGSMITH_GATEWAY_API_KEY` | none | separate gateway key when it differs from `LANGSMITH_API_KEY`; read only via `PAID_MEDIA_MODEL_API_KEY_ENV`, not by `Settings` (`.env.example:6-8,31-33`; `assembly.py:169-170`) |

The engine's own compose file hard-codes `DATABASE_URL=postgresql://paid_media:paid_media@postgres:5432/paid_media`,
`PAID_MEDIA_RUNTIME=self_hosted`, `PAID_MEDIA_API_HOST=0.0.0.0`, requires `engine/.env` via `env_file`, and
publishes the API on `127.0.0.1:8080` (`engine/docker-compose.yml:1-20`). The image installs the
`self-host`, `slack` and `reports` extras and `fonts-dejavu-core` only (`engine/Dockerfile:4-13`), so Arabic
PDF output needs an added font.

---

## 4. The single write path (what must stay true)

**Where adport writes today.** The only call to `AdProvider.applyWrite` in the repository is
`PolicyEngine.apply` (`platform/packages/core/src/policy/engine.ts:113`); the cloud `AccountScopedProvider.applyWrite`
is a delegating wrapper that the engine calls (`platform/apps/cloud/lib/cloud/account-scope.ts:86-88`). All four
surfaces reach the engine through `registry.call` → `guardedWriteTool`: CLI (`platform/packages/cli/src/program.ts:81-88`),
stdio MCP (`platform/packages/mcp/src/index.ts:170`), cloud REST (`platform/apps/cloud/app/api/v1/tools/[tool]/route.ts:13`),
remote MCP (`platform/apps/cloud/app/mcp/route.ts:11-14`). In the cloud, the pending row lands in
`public.pending_operations` via `PostgresPendingStore.put` and is what the Approvals page lists.

**Where the engine writes today.** Exactly one live adapter: `PipeboardWriteProvider.call_mutation`
(`engine/src/paid_media_agent/tools/pipeboard.py:196-217`), reachable only from `WriteExecutor.execute`, which
calls it up to twice per approval — an optional provider validate-only pre-flight (`tools/writes.py:816-823`) and
the single real attempt (`writes.py:849-851`) — both after `WriteGate.check` (`writes.py:793`; gate at
`198-220`). It exists only when
`PIPEBOARD_API_TOKEN` is set (`runtime/catalog.py:87-108`). The model cannot call it: provider mutations
are never registered as LangChain tools and `InvocationGuardMiddleware` denies direct calls
(`middleware/authorization.py:86-92`). In fixture mode the write provider is `FakeWriteProvider`, which
mutates in-memory state only.

**Exact code points to disable the engine's live write path** (configuration only, no engine source
edits):

1. Do not set `PIPEBOARD_API_TOKEN` in the engine container. `load_catalog` then returns `write_provider=None` and `configured_profile` keeps `FakeWriteProvider` with `write_provider_is_fake=True` (`runtime/catalog.py:61-86`; `runtime/mda.py:65-73`). No real platform **write** adapter exists (no `call_mutation` under `tools/direct/`), but the direct read adapters for X Ads and OpenAI Ads still reach real platforms when `X_ADS_*`/`OPENAI_ADS_API_KEY` are set (`catalog.py:59-60,81-86`), so leave those unset in demo profiles, and do not set `PAID_MEDIA_DATA_MODE=live` without credentials (`ValueError`, `catalog.py:63-64`). `PAID_MEDIA_DATA_MODE=sample` is an independent second guarantee of `write_provider=None` even if a token leaks in (`catalog.py:51-58`).
2. Keep `PAID_MEDIA_WRITES_ENABLED=false` (default, `config.py:156`) and leave `PAID_MEDIA_LIVE_WRITE_CATALOG_REVISION`/`PAID_MEDIA_LIVE_WRITE_CANARY_TOOLS` empty. For a non-fake provider `WriteGate.check` refuses with `writes_disabled` / `live_writes_not_released` / `stale_catalog` / `tool_not_released` (`writes.py:205-220`).
3. Create the kill-switch file at `PAID_MEDIA_KILL_SWITCH_PATH` (default `workspace/KILL_SWITCH`; a relative path resolves against `skills_root` = project root, i.e. `/app/workspace/KILL_SWITCH` in the image, `runtime/profiles.py:58-60`, `Dockerfile:10`, inside the compose **named volume** `workspace`, `docker-compose.yml:13,41`; `paid-media-agent writes kill-switch on|off` creates/removes it, `cli.py:437-442`). It is evaluated on every execution and refuses **even the fake** with reason `kill_switch` (`writes.py:198-203`); `propose_change` does not consult the gate, so proposals keep flowing. Caveat: an engine-side approve under the kill switch marks the proposal `rejected` with a `rejected` receipt (`writes.py:794-803`), and the switch also refuses any injected forwarding provider (see below).

**Exact point to intercept a proposal and hand it to adport.** `POST /threads/{thread_id}/messages`
(`surfaces/api/app.py:91`) returns `proposal` = the newest proposal on the thread (`runner.py:91-93,134`);
`interrupted=true` and `available_actions=["approve","edit","reject"]` appear only when the model also called
`execute_change`, the sole interrupting tool (`surfaces/api/views.py:23-30`; `assembly.py:256-258`). A bridge
should key on `proposal.state=="awaiting_approval"` and a new `proposal.proposal_id`, not on `interrupted`. The
bridge runs in the adport cloud server (never the browser, because of CSP) and should:

1. Map `proposal.platform` + `account_ref` (an engine alias) to an adport provider id and an **enabled** `organization_ad_accounts.account_id`; the engine never exposes the provider account id, so this mapping lives on the adport side.
2. Translate `tool_name`/`after[]` to an adport guarded tool call — e.g. `google_ads__update_campaign_budget` → the matching `<provider>_set_budget` with that provider's units, using each `after[]` item's `unit` (the engine's fixture `daily_budget` is whole currency units, `tools/fixtures.py:439-440`; Google and Snapchat take integer micros, TikTok float units, §2.1). For status flips use `provider.standardActions?.()?.pauseCampaign?.(accountId, campaignId)` — both members are optional in the type system (`platform/packages/core/src/provider.ts:67-69,81`; the cloud wrapper returns `{}` when absent, `apps/cloud/lib/cloud/account-scope.ts:91`) — and fall back to the provider's `<provider>_set_campaign_status`/`_set_status` tool when `pauseCampaign` is undefined.
3. Call `runtime.registry.call(toolName, {account_id, ...payload}, runtime.ctx)` **without** `pending_operation_id` under a `createTenantRuntime(principal)`. Neither `createTenantRuntime` nor `ToolRegistry.call` reads `principal.scopes`/`entitlement` (`platform/apps/cloud/lib/cloud/runtime.ts:44-147`; `platform/packages/core/src/tools/registry.ts:82-90`): inside the registry the only guard is `authorizeToolCall` (enabled-account scope, `registry.ts:88`; `account-scope.ts:36-56`), and plan/scope gating lives in the HTTP edges (`requireScope`, `app/api/v1/tools/[tool]/route.ts:11`; `packages/mcp/src/index.ts:122-124`). A server-side bridge must therefore itself run `applyPlanToPrincipal` and `requireScope(principal, 'tools:write')` (`lib/cloud/plans.ts:81-104`; `lib/cloud/auth.ts:39-41`) — i.e. a non-viewer member of an org whose subscription is active/trialing/past_due on a `writeAccess` plan — or it silently bypasses the reader-plan restriction. `PolicyEngine.validate` then produces the hash, preview and the `public.pending_operations` row; the Approvals page shows it immediately. Never insert into `pending_operations` directly — `apply` verifies `operation_hash === hashOperation(op)` (`engine.ts:104`).
4. Then `POST /proposals/{id}/reject` with a message like "handled by adport" so the engine thread resumes (`app.py:126-138`), or simply never call `/approve`. Error contract: 409 only for an unknown proposal id (`WriteDenied`, `runner.py:265-267`; so "never existed" is not distinguishable from a conflict by status) or a concurrent-save conflict (`writes.py:553-555`); rejecting a proposal whose state is no longer `proposed|awaiting_approval|revised` raises an unhandled `InvalidTransition` (`writes.py:498-500` → `domain/proposals.py:44-74`, a plain `Exception` with no handler in `app.py`) and surfaces as HTTP 500. `GET /proposals/{id}` and check `state` first, or treat 500 as "already handled". Any valid bearer can reject (§5 #13), so the bridge's service token can reject proposals created by any other caller_ref.
5. Apply from adport later with the identical arguments plus `pending_operation_id` within `pending_ttl_minutes` (default 15). Any human-approval loop longer than that (e.g. WhatsApp) must re-validate. The dashboard has no apply button today; adding one means a session-authenticated route that rebuilds the tenant runtime and calls `registry.call(row.operation.tool, {...row.operation.payload, account_id: row.operation.accountId, pending_operation_id: row.id})`.

An alternative, lower-fidelity hand-off is to persist the proposal as an `AuditFinding` with
`proposedAction: {tool, input}` through `FindingsRepository.save`, which then appears in
`recommendations_list` and can be driven by `recommendation_apply` (`platform/packages/core/src/audit/tools.ts:93-134`).

If a tighter coupling is wanted later without touching `engine/`, `WriteProvider` is a Protocol and
`RuntimeProfile` is a frozen dataclass built with `dataclasses.replace`; a bridge runtime can
`dataclasses.replace(profile, write_provider=<forwarding provider>, write_provider_is_fake=True)` so
`WriteGate.check` passes without the live flags (`writes.py:204-205`). `fixture_profile(write_provider=…)` is typed
`FakeWriteProvider | None` and hard-codes `write_provider_is_fake=True` (`runtime/profiles.py:131,147-148`; the
pattern `engine/tests/contract/helpers.py:59-84` uses), while `test_live_write_gates.py:51-64` shows the `replace`
mechanics but sets `write_provider_is_fake=False` to exercise the live gates — the bridge flips that flag the
other way. Such a provider must answer the validate-only pre-flight (`{…, validate_only: True}`,
`writes.py:816-823`) without creating an adport pending operation — `FakeWriteProvider` returns
`{"validated": True}` with no state change (`tools/fixtures.py:457-466`) — or the executor marks the proposal
`failed` (`writes.py:824-839`). The executor's readback would then report `failed`/`unknown` for asynchronously
applied changes, which must be accounted for.

Invariants to keep: one `applyWrite` call site; no new tool namespace that bypasses
`createAccountScopeAuthorizer` (bridge tools that take `account_id` must use an existing provider namespace,
or the authorizer rejects them, `account-scope.ts:48-54`); no bridge tool whose name matches
`/^(demo|mock|synthetic)(_|$)/` or whose namespace is exactly `demo|mock|synthetic`, and no bridge *provider*
whose id is outside `PROVIDER_IDS` (`platform/packages/mcp/src/index.ts:28,89-93`), because the cloud `/mcp`
route runs with `productionOnly: true` (`app/mcp/route.ts:43`) and would then refuse **every** request; engine
container without `PIPEBOARD_API_TOKEN` in every compose profile, with the kill switch engaged only when the
bridge does **not** inject a forwarding write provider — the switch is checked before the fake short-circuit and
refuses every execution, fakes included (`writes.py:199-205`), so it and the forwarding-provider alternative above
cannot both hold.

---

## 5. Known divergences between README and code

| # | Claim | Reality |
| --- | --- | --- |
| 1 | `platform/README.md:28`: "account, report, and audit operations return `NOT_CONNECTED`" without credentials | `recommendations_list` and `recommendation_dismiss` read the findings store regardless (`platform/packages/core/src/audit/tools.ts:66-92`); `audit_preview`/`audit_run` do fail closed. |
| 2 | `platform/README.md:108`: policy lives at `~/.config/adport/policy.yaml` | `$ADPORT_POLICY` and `./adport.policy.yaml` take precedence (`platform/packages/core/src/policy/policy.ts:38-44`). |
| 3 | `platform/README.md:212`: `supabase/migrations/` holds "database tests" | No SQL tests exist under `platform/supabase`; DB tests are vitest suites in `platform/apps/cloud/test/*.database*.ts`, gated by env and not run in CI (`platform/.github/workflows/ci.yml`). |
| 4 | `platform/docs/write-safety.md:9`: apply rejects "newly protected accounts, and policy violations" | Apply re-runs only `checkStaticPolicy` (protected accounts); budget caps are checked only at validate (`engine.ts:62,110-111`). |
| 5 | `platform/docs/write-safety.md:7`: adport "applies required coercions such as paused creation" | The engine only passes `forcePausedCreation`; coercion is provider-side and never verified by the engine (`engine.ts:54-56,61`). |
| 6 | `platform/docs/write-safety.md:32`: audit `event` is `validated, applied, rejected, or note` | Cloud writes 15 event kinds (`repository.ts:271-273`; DB CHECK). |
| 7 | `platform/docs/deployment-model.md:26` and `docs/cloud-local-development.md:29`: cloud runtime supports "six providers" | `CLOUD_PROVIDERS` and the DB CHECKs list 11; the runtime instantiates Snapchat et al. behind `*_OAUTH_ENABLED` and the test-org allowlist (`platform/apps/cloud/lib/env.ts:56-72`). |
| 8 | `platform/README.md:120`: Snapchat "cloud discovery and empty report verified" | `platform/docs/providers/snapchat.md` states wire tests are not live verification; `platform/CHANGELOG.md` stops at 0.5.2 while packages are 0.6.1. |
| 9 | Policy schema advertises `require_validation` (`platform/packages/core/src/policy/policy.ts:9`) | Stored and echoed (DB default `20260817171039:48`, dashboard form default `apps/cloud/app/dashboard/policies/policy-form.tsx:51`, asserted in `packages/cli/test/program.test.ts:150-152`) but never consulted at runtime: `PolicyEngine` (`core/src/policy/engine.ts:47-165`) has no branch on it and the two-step gate in `guardedWriteTool` is unconditional (§2.3). |
| 10 | `engine/README.md:92-93`: `report` "runs without" a model | True for model *calls*, but the chat model object is still constructed via `init_chat_model` (`engine/src/paid_media_agent/assembly.py:147-172`); a provider whose client demands a key at construction would still break it. |
| 11 | `engine/README.md:154-155`: "Report files are available locally and through the self-hosted API" | Only reports produced by `render_report` inside a thread are downloadable; CLI `report` output is not bound to any thread (`surfaces/runner.py:95-123`; `app.py:150-166`). `OPERATIONS.md:115` repeats the claim. |
| 12 | `engine/docs/architecture/runtime-profiles.md:57`: self-hosted offers "Slack cards with edits" | Slack renders only Approve/Reject buttons (`surfaces/slack/blocks.py:9-10`; no edit handler under `surfaces/slack/`); edit exists only on the HTTP API (`app.py:140-148`). `docs/self-hosting.md:45` ("There are no tool-specific Slack cards") is accurate. |
| 13 | Engine docs imply API-level reviewer identity | `POST /reject` and `/edit` check only that the bearer is valid; any token holder who knows a proposal UUID can reject or revise it (`app.py:126-148`; `runner.py:257-286`). |
| 14 | Phase plan: "create packages/snapchat" | Already exists upstream with OAuth, reports, three guarded writes, 37 wire tests, CLI wizard and cloud wiring (§2.1). |
| 15 | Engine `PAID_MEDIA_RUNTIME` suggests it selects what `serve` runs | `serve` always builds `name="self_hosted"` (`runtime/self_hosted.py:72`); the flag only changes doctor/console checks. |

---

## 6. Open questions

1. **Dashboard apply/reject UI.** The Approvals page is display-only. Phase 1's "appears in adport's existing Approvals page" is satisfiable, but any in-dashboard approve/reject is new UI plus a new session-authenticated route (§4 step 5). Should adport become the approver, and if so with which actor identity in `audit_events`?
2. **Identity mapping between the two systems.** Engine identity is a `caller_ref` string from `PAID_MEDIA_API_TOKENS`; thread ownership is first-caller-wins. One service token (one caller_ref, thread ids namespaced per adport user) is simplest but collapses requester/approver separation on the engine side; one token per adport user requires rewriting `.env` (`config generate` overwrites the whole variable). Decision pending.
3. **Plan gating in local demo.** The default `reader` plan strips `tools:write`, so a fresh local org cannot create previews via API key or MCP until an `organization_subscriptions` row grants `operator`+. The compose stack needs a documented seed step (through Supabase Auth so `handle_new_user` fires) or a dev-only override.
4. **Reports page data source.** No engine HTTP endpoint triggers a report. Options: exec `paid-media-agent report --json` in the api container and read `workspace/out` from a shared volume; ask for a report via chat and serve files through the owner-only artifact route; or add a small bridge service outside `engine/`. Which is acceptable for Phase 1?
5. **Model key requirement for the Assistant.** `serve` cannot use `scripted:demo`; a real model key is required even on fixture data. Is an offline Assistant demo required, or is "fixture data + real model" the Phase 1 target?
6. **Database topology.** The engine runs `CREATE TABLE IF NOT EXISTS` for `pma_*` and LangGraph tables on its `DATABASE_URL`; adport needs the Supabase image (pg_cron, auth schema, `adport_backend` role). Two Postgres instances (engine's `postgres:16-alpine` + Supabase) or one Supabase DB with a separate engine database/schema?
7. **Audit event vocabulary.** Representing an engine proposal in adport's audit log requires either a new CHECK value (`proposed`, migration + TS union) or reusing `note` with `tool='engine_proposal'`. Preference?
8. **Snapchat in the engine.** `snap_ads` is a Pipeboard platform with no fixture data, no normalization (`PERFORMANCE_PLATFORMS` excludes it) and no admitted writes. Should Phase 3 add a Snapchat fixture/normalization to the engine, or is Snapchat analysis out of scope for the AI side?
9. **Unverified reader details.** A few specifics (exact physical-CSS declaration count in `globals.css`, the engine's 37/12 test counts) were taken from the Phase 0 readers and not re-opened for this document; treat them as approximate. (Google/Meta `serverDryRun:true` has since been verified in §2.1.)
10. **RTL in engine reports.** `report.html.j2` hard-codes `lang="en"` (`reports/templates/report.html.j2:3`) and English labels and only references `var(--font-family)`/`tokens['font-family']` (lines 15,20,119-120); the Inter / IBM Plex Mono stack itself is defined in `reports/templates/tokens.j2:18-19`, and the Docker image ships only DejaVu fonts (`engine/Dockerfile:5-6`, `fonts-dejavu-core`). Arabic PDF reports need changes to both templates plus a font package inside `engine/`, which conflicts with keeping `engine/` read-only — decide whether to fork the templates via `ReportRenderer(out_dir, templates_dir=…)` (`reports/render.py:391-401`) from a bridge or to patch upstream.
