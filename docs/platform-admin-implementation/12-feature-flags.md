# 12 — Feature Flags (PARTIAL / roadmap)
The only flag mechanism is the env-var provider allowlist (`provider-rollout.ts`). A DB-backed global/plan/org flag
model with rollout + emergency disable is roadmap Wave 16 and must WRAP (not fork) the existing provider rollout.
Flags are never used as security authorization. `/admin/flags` is a PARTIAL stub.
