# 05 — Account / Campaign Workflows — PARTIAL

## What exists today

- The **Reports** page (pre-existing) shows a 30-day campaign table and the engine report runner.
- The **Needs Attention** workspace (new, DONE) composes an account-scoped diagnosis
  (`context.accountId`) across media/commerce/creative with ranked factors and recommendations — the
  analytical core of an account drill-down, reachable now.
- The orchestrator context already carries `accountId`/`provider`/`period`/`comparisonPeriod`, so a
  per-account or per-campaign composition is a matter of passing scope + wiring a page.

## What remains — NOT_STARTED

A dedicated Account detail page (`/dashboard/accounts/[id]`) and Campaign detail page that stitch
Overview → Campaigns → Performance → Diagnostics → Creatives → Commerce → Recommendations → Timeline →
Experiments → Outcomes into one connected drill-down (Program 5/5.1). The data sources for several of
these legs (live provider reads, connected store) are `BLOCKED_EXTERNAL` without credentials; the
composition layer and the demo gatherer make the page buildable, but the dedicated routes and the
per-campaign gatherer were not built in this pass.

**Honest note:** today a user reaches account-level intelligence through the Workspace surface, not
through a per-entity drill-down. The drill-down is the next highest-leverage UI increment.
