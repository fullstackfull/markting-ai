# 01 — Live data architecture

## Decision: engine reads tenant data through a trusted backend interface, not broad raw credentials
The engine must NOT hold every customer's raw ad-platform credentials. The sanctioned boundary reuses
the Phase-0 governed platform runtime: adport already holds encrypted per-tenant provider credentials
and exposes a normalized, account-scoped read via the core `report` tool (`AccountScopedProvider` +
`createTenantRuntime`). The live read path is therefore:

```
connected provider (OAuth)  →  adport governed runtime (encrypted creds, account scope)
                             →  core report() → ReportRow[]  →  normalize() → MetricObservation[]
                             →  deterministic analysis + selective context  →  AI narration (engine, read-only)
```

The engine receives **normalized, tenant-scoped observations and structured context**, never raw
provider secrets. Tenant identity is carried by `EngineContext` (server-derived) and, for reports,
the `X-Markting-Org` header; chat threads are org-namespaced and gated in the cloud.

## What is built (and unit-tested) here
- `normalize()` turns adport `ReportRow`s (which already come from real connected accounts via the
  governed runtime) into canonical `MetricObservation`s with trust/currency/timezone/attribution.
- The deterministic analysis engine + selective context builder operate entirely on those
  observations — so the **cloud** can analyze a tenant's real connected-account data today.
- Read-only capability (`ToolContext.readOnly`) is enforced at the registry in live read-only modes.

## What remains (external-blocked or an explicit later decision)
- **Live OAuth / a real connected account** cannot be exercised in this sandbox; the path is built and
  tested against the typed read interface + synthetic fixtures. Connecting a real account is a
  deploy/runbook step (see 08 + PRODUCTION-VERIFICATION-RUNBOOK §Provider connection).
- **Lifting the engine's fixture pin for the LLM narration path** requires injecting an
  adport-backed ReadProvider into the engine so the model narrates real data. The engine is vendored
  byte-identical (drift-checked), so this is done in the host (`services/engine-demo`) build, not in
  `engine/`, and is a staged change behind the kept fail-closed default. Until then, the LLM narrates
  the cloud-computed signals; the deterministic signals themselves are already real-data-capable.
