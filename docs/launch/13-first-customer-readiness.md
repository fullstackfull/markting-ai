# 13 — First Paying Customer Readiness (Stage 22)

Critical items and honest status:

| Item | Status |
|---|---|
| TLS | BLOCKED_EXTERNAL (edge, deploy-time) |
| KMS | PARTIAL (rotation-safe envelope proven; cloud KMS blocked) |
| Backup restore | PARTIAL (logical drill proven; cluster restore blocked) |
| DB | READY (migrations + RLS + isolation proven on real Postgres) |
| Queues | PARTIAL (lease/claim proven; durable backend blocked) |
| Observability | PARTIAL (model proven; backend blocked) |
| Provider read | BLOCKED_EXTERNAL (no creds) |
| AI | PARTIAL (governed gateway + fallback; live model blocked) |
| Commerce (if sold as included) | BLOCKED_EXTERNAL / OPTIONAL |
| Tenant isolation | READY (RUNTIME_PROVEN) |
| Billing | PARTIAL (plans/entitlements present; live Stripe + VAT/SAR unresolved) |
| Support | READY (runbook) |
| Onboarding | READY (flow + docs) |

## Launch-mode decision
- **Mode A (intelligence-only)** is the safer, operationally-first launch: it needs live provider READ +
  live model (+ optional commerce), and NO write-governance exposure. Once those external reads are
  connected at deploy, Mode A is READY — the code path is proven today.
- **Mode B (human-approved execution)** adds controlled writes; the governance is proven on sandbox +
  real Postgres, but a live write pilot + rollback are HELD on credentials. Mode B is HELD, not required
  for first revenue.

Recommendation: **launch Mode A first**; enable Mode B per-customer after the controlled live-write
pilot (runbook `docs/phase7/11`) passes against a dedicated test account. Autonomous optimization stays
DISABLED.
