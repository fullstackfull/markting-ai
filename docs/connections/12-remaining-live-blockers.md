# 12 — Remaining Live Blockers (BLOCKED_EXTERNAL)

Everything code-solvable is built and CI-verified. The following require real external systems/credentials
and cannot be closed by code here; each is labelled BLOCKED_EXTERNAL in the product, never faked.

| Blocker | Why | What unblocks it |
|---|---|---|
| Live paid-media OAuth + reads/writes | No tenant provider credentials + no Adport-owned app secrets in this environment | Configure the hosted OAuth app secrets per provider; connect a real tenant |
| Live contract capture (LIVE_CAPTURED fixtures) | No live provider responses to record | Capture against a real sandbox/live grant |
| Commerce live transport | Connectors use an injectable `RawSource`; no HTTP client wired, no credentials | Implement a live `RawSource` per platform + credential ingress |
| Commerce webhook ingress | Verifier built; no HTTP route mounts it | Mount a route calling `ingestWebhook` with the stored signing secret |
| Background sync / observation runner | No in-repo worker/cron executes `runIncrementalSync`/`claimDueJobs` | Deploy a worker or Vercel Cron; wire `last_sync_at`/next-run |
| Live AI cost attribution | AI gateway is a dormant deterministic seam; no live model | Wire a live model behind the gateway |
| True edge System Health (webhook/provider freshness, /health) | No edge metrics backend | Add a metrics/log backend |
| User session/suspend/revoke + safe impersonation | Needs Supabase GoTrue session/admin APIs | Surface GoTrue admin APIs behind guards |
| Live Stripe billing truth | Env-gated; no live Stripe data | Provision Stripe product/prices + webhook history |

## Honesty guarantee
The control plane reports these as BLOCKED_EXTERNAL (status, notes, action results) rather than rendering a
fabricated success, health light, or freshness timestamp. No live verification is claimed anywhere without
actual live evidence.
