# 11 — UI Capability / Visibility Matrix (mandatory artifact)

**What this is:** for every major backend capability, whether it exists in the backend, whether any UI
exposes it, whether a user can *act* on it in-product, whether it is reachable by clicking (not only by
typing a chat prompt), and whether it is mobile-ready. @ `affdecc`, static reading.

Legend: ✅ yes · ⚠️ partial/indirect · ❌ no. **CONNECTED_TO_WORKFLOW** = a user can act on it
in-product. **DISCOVERABLE** = reachable by clicking, not only by typing a chat prompt.

| Capability | Backend module | BACKEND_EXISTS | UI_EXISTS | CONNECTED_TO_WORKFLOW | DISCOVERABLE | MOBILE_READY | Tag |
|---|---|---|---|---|---|---|---|
| Spend/clicks/conv/ROAS totals | `lib/cloud` reads + providers | ✅ | ✅ Overview tiles | ⚠️ read-only | ✅ | ✅ | UI_EXPOSED |
| Campaign list (30d) | provider reads | ✅ | ✅ Reports table | ⚠️ read-only | ✅ | ⚠️ (table scroll) | UI_EXPOSED |
| Engine PDF/HTML report | `engine-client` → Python | ✅ | ✅ Engine Reports | ✅ run + download | ✅ | ✅ | UI_EXPOSED |
| Diagnostics (CPA/ROAS factor) | `intelligence/diagnostics.ts`, `commerce/diagnostics.ts` | ✅ | ⚠️ finding text / chat only | ❌ | ⚠️ (findings page not fed by engine) | ⚠️ | BACKEND_ONLY |
| Recommendations | `intelligence/recommendation.ts`, `optimize/`, `creative/` | ✅ | ⚠️ inert `finding.recommendation` string + chat prose | ❌ no accept/apply list | ❌ no page | ⚠️ | BACKEND_ONLY / PARTIAL |
| Memory | `memory*.ts` | ✅ | ❌ | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Outcomes / learning | `outcomes.ts`, `outcome-*`, `learning.ts` | ✅ | ❌ (only `markPendingOutcome` on approve) | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Creative intelligence | `creative/{classify,clustering,dedup,fatigue,performance,visual,recommendations}` | ✅ | ❌ ZERO imports | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Commerce / profit / MER | `commerce/{profit,revenue,reconciliation,products,metrics,targets}` | ✅ | ❌ ZERO imports (ROAS shown is ad-side) | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Experiments | `optimize/{experiment-model,sample,contamination}` | ✅ | ❌ | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Optimization / allocation | `optimize/{allocation,response-curve,simulate,workbench,constraints,guardrails}` | ✅ | ❌ ZERO imports | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Pacing / budget-burn | `intelligence/pacing.ts` | ✅ | ❌ | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Anomaly / alerts | `intelligence/anomaly.ts`, `notifications.ts` | ✅ | ❌ no feed | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Forecast | `intelligence/forecast.ts` | ✅ | ❌ | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Opportunity center | `intelligence/opportunity-center.ts` | ✅ | ❌ | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Morning brief | `intelligence/brief.ts`, `brief-memory.ts` | ✅ | ⚠️ closest = PDF download | ❌ | ⚠️ | ✅ | PARTIAL |
| Approvals | PolicyEngine, `ops/approval-policy.ts` | ✅ | ✅ Approvals page | ✅ apply/reject | ✅ | ✅ | UI_EXPOSED |
| Audit log | `recordAudit`, `PostgresAuditStore` | ✅ | ✅ Audit page (150 events) | ⚠️ read-only | ✅ | ✅ | UI_EXPOSED |
| Policies / guardrails | `@adport/core` policy, `ops/*` | ✅ | ✅ Policies page | ✅ policy-form → settings | ✅ | ✅ | UI_EXPOSED |
| Findings (4-rule audit) | `packages/core/.../core-performance.ts` | ✅ | ✅ Findings page | ❌ read-only, agent-populated only | ⚠️ page exists, no run button | ⚠️ | PARTIAL |
| Agency / multi-client | `ops/agency.ts`; billing `clientWorkspaces` flag | ✅ | ❌ no client switcher | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Usage / cost | `usage-ledger.ts` | ✅ | ❌ (billing shows tiers only) | ❌ | ❌ | ⚠️ | BACKEND_ONLY |
| Provider health | `ops/provider-health.ts`, engine `health()` | ✅ | ⚠️ connection status pills | ⚠️ reconnect | ⚠️ | ✅ | PARTIAL |
| Kill switch | `ops/kill-switch.ts` | ✅ | ❌ (no emergency-stop toggle) | ❌ | ❌ | ❌ | BACKEND_ONLY |
| Connections (OAuth) | `lib/cloud/runtime.ts` (11 providers) | ✅ | ✅ Connections page | ✅ connect/disconnect | ✅ | ✅ | UI_EXPOSED |
| Accounts (enable/cap) | `listOrganizationAdAccounts` | ✅ | ✅ Accounts page | ✅ enable/disable | ✅ | ✅ | UI_EXPOSED |
| API keys / MCP | `app/mcp/route.ts`, api-keys | ✅ | ✅ Agents page | ✅ mint/revoke keys | ✅ | ✅ | UI_EXPOSED |
| Team / RBAC | `lib/cloud/tenant-admin.ts`, `ops/rbac.ts` | ✅ | ✅ Team page | ✅ roles/members | ✅ | ✅ | UI_EXPOSED |
| Billing / plans | billing + Stripe | ✅ | ✅ Billing page | ⚠️ plan select; live Stripe untested | ✅ | ✅ | PARTIAL |
| Assistant (chat) | `assistant.ts` → Python engine | ✅ | ✅ Assistant page | ⚠️ scripted demo / external | ✅ | ✅ | PARTIAL / BLOCKED_EXTERNAL |

## Count

- **UI_EXPOSED and genuinely usable (read or act):** ~11 — all reporting (Overview, Reports, Engine
  Report) and governance/ops (Approvals, Audit, Policies, Connections, Accounts, Agents, Team) + Billing
  (partial).
- **BACKEND_ONLY (built, zero UI):** ~13 — diagnostics (as engine), recommendations, memory, outcomes,
  creative, commerce/profit/MER, experiments, optimization/allocation, pacing, anomaly, forecast,
  opportunity center, agency, usage/cost, kill switch.
- **PARTIAL / indirect:** findings (agent-populated), morning brief (PDF), provider health (pills),
  assistant (scripted).

## Headline

**The intelligence half of the product has essentially no discoverable, workflow-connected UI.** The
reachable product is a reporting + governance + connection shell. Of the 15 "intelligence" capabilities,
**8+ are BACKEND_ONLY with no UI at all**; the rest surface only as inert text, a downloadable PDF, or
scripted chat. This matrix is the single clearest artifact of the reassessment's central finding.
