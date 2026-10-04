# C.5 (12) — Pilot observability checklist / dashboard

What an operator watches during the controlled pilot. Each row maps to a concrete source the platform
already exposes; the dashboard is a read over these. Reviewed each day of the pilot.

| Signal | Source | Healthy | Watch / abort |
|--------|--------|---------|---------------|
| Last provider read (per account) | sync job `SUCCEEDED` timestamp (`markting_sync_jobs`) | within cadence (`sync-scheduler.ts`) | older than the tier SLO |
| Data freshness | `classifyFreshness` (`freshness.ts`) | FRESH | STALE → investigate |
| Connection health | `deriveProviderHealth` (`provider-health.ts`) | CONNECTED | AUTH_EXPIRED / RATE_LIMITED / ERROR |
| Errors | sync `DEAD_LETTER` count, alert instances (`markting_alerts`) | 0 | any `CRITICAL` alert |
| Normalized row count | gatherer output (per sync) | > 0, matches native UI sample | 0 when spend > 0 |
| Rejected rows | `validateReportRow` rejections (counted, not dropped) | ~0 | a rising reject rate → schema drift |
| Schema drift | `PROVIDER_SCHEMA_CHANGED` (`schema-drift.ts`) | NONE | BREAKING → pause, review adapter |
| Diagnostics generated | daily diagnosis answers (deterministic) | present with evidence | missing evidence / overclaim |
| AI (if Stage 3) | AI usage ledger (`markting_ai_usage`), eval rubric | grounded, within cost budget | `AI_COST_ANOMALY`, overclaim |
| User interactions | dashboard telemetry (`intel-telemetry.ts`) | — | — (qualitative) |
| Alerts | `/admin/incidents` recent alerts | none open | any open CRITICAL |
| Incidents | `/admin/incidents` | none open | any open; abort criteria met → open one |
| Kill-switch | `markting_kill_switches` | armed + verified | fails to halt within one tick → abort |

Operator cadence: review the checklist at least daily during the pilot, and on every CRITICAL alert.
Any abort-criteria hit (`C5-pilot-runbook.md`) → trip the kill-switch and open an incident immediately.
