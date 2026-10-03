# 05 — AI context architecture

`platform/apps/cloud/lib/markting/intelligence/context.ts` + `engine-context.ts`.

## Tenant context is structured and server-derived
`EngineContext` carries organization_id, user_id, request_id, thread_id, locale, timezone, currency,
runtime mode, and capability scope. These come ONLY from the authenticated principal and server
config — never from the LLM or user prose, and they are passed as structured fields/headers, not
concatenated into system-prompt text as the primary control. Every report/thread/tool/model/usage
event is attributable to organization_id (reports via `X-Markting-Org`; chat via the org-prefixed,
cloud-gated thread id; usage via the ledger).

## Selective assembly + budgeting
`buildAnalysisContext` does NOT dump the account into the prompt. It selects the comparison windows,
the top-N campaigns by their share of the account spend movement (contribution-ranked), and material
signals, and reports the summarized remainder (`summarizedCampaignCount`, `truncated`) rather than
silently dropping data. Budget caps (`maxCampaigns`, `maxRows`) bound model cost regardless of account
size. The output is structured (currency, timezone, trust, targets, account change, top campaigns),
so the model explains governed signals instead of recomputing them. Tested in `intelligence.test.ts`.
