# 10 — Security Center & Global Audit (READY baseline)
`/admin/security` reads (via platformDb, SELECT-only): the safety posture (runtime mode, Mode-B HELD, autonomous
DISABLED, kill-switch enforced), active kill switches (all scopes), and the recent **append-only platform admin
audit** feed (actor/role/action/target/reason, linkable by correlation id). `/admin/governance` shows the runtime
posture and the GLOBAL kill switch control (SUPER_ADMIN only, reason-required, audited). A unified global audit that
also folds tenant audit_events + provider/billing events with rich filters is roadmap Wave 14 (the platform-action
half is READY). WAVE 0.2/0.3 hardened service-account hashing and scheduled MCP token purge.
