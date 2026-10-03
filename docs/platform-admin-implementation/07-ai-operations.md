# 07 — AI Operations (PARTIAL / roadmap)
`markting_ai_usage` captures per-org tokens/cost/latency/status; the Overview surfaces billable request counts and a
cost that is NOT_AVAILABLE while the gateway is deterministic/local-fallback (no live model traffic). Fleet cost
rollups by org/user/model, per-org quota overrides, disable-AI-per-org, and model routing/disable controls are
roadmap Wave 9 and shown as PARTIAL (`/admin/ai`). No prompt/body content is exposed. Deterministic mode must never
report fabricated model cost.
