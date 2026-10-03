# 04 — Users (READY read; PARTIAL actions)
`/admin/users` — searchable, paginated directory from `profiles` (display name, user id, org count, operator flag).
Email is intentionally NOT exposed to the SELECT-only platform read role (it lives in the auth provider). `[id]`
detail shows org memberships + tenant roles and the operator role if any. Actions (suspend, revoke sessions/keys,
export, impersonation) are PARTIAL — they need auth-provider session APIs; impersonation is DEFERRED (see 10/exit).
