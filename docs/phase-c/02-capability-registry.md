# C0.2 — One authoritative provider capability registry

## Single source of truth

`lib/connections/registry.ts` is the ONE machine-readable description of what each integration can
do, grounded in the audited adapter code. For paid-media providers it carries a `reporting`
capability:

- `levels` — hierarchy support per level (`account` / `campaign` / `ad_group` / `ad`), each
  `READY` / `PARTIAL` / `NOT_SUPPORTED` / `NOT_IMPLEMENTED`.
- `adGroupTerm` — the provider-native label ("Ad set" / "Ad group" / "Ad squad" / "Line item").
- `dimensions` — breakdown support, each `READY` (flows into the normalized ReportRow path) /
  `RAW_ONLY` (reachable only via a raw passthrough tool) / `NOT_SUPPORTED` / `NOT_IMPLEMENTED`.
  No provider is `READY` today — no adapter feeds a breakdown into the normalized path.

Projection helpers (never a second map): `reportingLevelSupport`, `reportingDimensionSupport`,
`reachableBreakdownDimensions`, `adGroupTerm`.

## The duplicated map is removed

`lib/markting/intelligence/audience.ts` previously held its own `PROVIDER_BREAKDOWN_SUPPORT` —
an optimistic per-provider boolean map that diverged from the registry (it claimed
`meta.audience_segment = true` and `google.{placement,device,geography,age,gender} = true`, none of
which the audited adapters expose in a reachable form). That map is **deleted**. `supportsBreakdown`
is now a pure projection of the registry through an explicit dimension-vocabulary bridge
(the analysis engine's `audience_segment` ↔ the registry's `audience`; all other names identical):

```ts
supportsBreakdown(provider, dim) =
  reportingDimensionSupport(provider, ENGINE_TO_REGISTRY[dim]) ∈ { READY, RAW_ONLY }
```

The Breakdown Explorer (`lib/cloud/breakdown-explorer.ts`) already gated on the registry; now the
seed analysis engine agrees with it by construction, so the seed analysis, the explorer, and the UI
gating can never diverge.

## Honest consequences (reflected, not fabricated)

- **Meta** exposes placement/device/geography/age/gender as `RAW_ONLY` (raw export, not the
  normalized report) and has **no** saved/custom-audience (`audience_segment`) insights breakdown.
  The executable benchmark's "which audiences convert best?" (#35) is therefore answered honestly
  via the demographic (age/gender) split — protected dimensions, reported for transparency, never
  turned into an exclusion recommendation.
- **Google** has no normalized breakdown wired (`keyword`/`search_term`/`network`/`device`
  `NOT_SUPPORTED` today), so `supportsBreakdown('google', …)` is uniformly false.

## Tests

- `test/capability-registry-single-source.test.ts` pins the invariant: `supportsBreakdown` equals
  the registry projection for every provider/dimension, so any reintroduced divergent map fails CI.
- `test/phase2-intelligence.test.ts` and `test/breakdown-explorer.test.ts` remain green under the
  projection.
