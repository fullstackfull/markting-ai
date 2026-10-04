# 09 — Breakdown Explorer (B11) + attention-queue transparency (B25)

## What is real

A media buyer picks a supported breakdown dimension (placement / device / geography / audience / age /
gender / network / keyword / search_term) and sees per-value rows — **spend, conversions, CPA, ROAS,
spend share** — plus the deterministic concentration (HHI) and efficiency-spread (best/worst CPA)
findings from the existing `analyzeBreakdown` engine.

- **Route**: `app/dashboard/accounts/[accountId]/breakdowns/page.tsx` (server component). Awaits the
  Promise `params` / `searchParams`, wires `RangeControl` + `FreshnessBar` + `IntelMeta` exactly like the
  account page, and is reached from an "Open Breakdown Explorer →" link on the account surface.
- **Dimension selector**: `breakdowns/dimension-control.tsx` (client) writes the chosen dimension into a
  `dim` search param while **preserving `range` and every other param** — the same
  `URLSearchParams` + `router.push` pattern as `components/range-control.tsx`. Only reachable dimensions
  are active chips; unreachable ones are shown disabled, so the control can never select unsupported data.
- **Rows table**: the shared `AnalyticsTable` (`prefix='b'`; columns value / spend / conversions / CPA /
  ROAS / share; all sortable; URL-state via `parseTableState`/`applyTableState`). Money renders via
  `formatMoneyMinor(minor, currency, locale)` with per-row currency — no blending. CPA/ROAS are `null`
  (shown as `—`) when the denominator is 0, never a fabricated 0.
- **DEMO data source**: the CLEARLY-SYNTHETIC seed (`acc.breakdowns` in `orchestrator/seed.ts`) fed
  through the real engine. The trust badge reads `SYNTHETIC` and the table carries an explicit
  "Synthetic demo data" note. `sandbox:acc:ramadan` seeds placement / device / geography / audience and
  (added for B11) **age / gender**, so the protected-dimension guard is demonstrable.

## Capability gating (the single source of truth is the registry)

Gating is computed by the pure, unit-tested helper `lib/cloud/breakdown-explorer.ts`, which reads
`reportingDimensionSupport` / `reachableBreakdownDimensions` / `BREAKDOWN_DIMENSIONS` from
`lib/connections/registry.ts` (never duplicated). It bridges the registry vocabulary to the
`analyzeBreakdown` engine vocabulary (`audience` ↔ `audience_segment`; `network`/`keyword`/`search_term`
have no engine vocabulary and are only ever `NOT_SUPPORTED`).

Explicit, distinct states (B22) — an empty table is never passed off as "no data":

- `OK` — reachable (`READY`/`RAW_ONLY`) **and** rows exist → table + findings. A `RAW_ONLY` dimension
  shows "available only via raw export, not in the normalized report".
- `NO_DATA` — reachable but no rows in the window → distinct "no data for this dimension" note.
- `NOT_SUPPORTED` — `NOT_SUPPORTED`/`NOT_IMPLEMENTED` per registry → `AnalyticsTable`'s `unavailable`
  state. A dimension marked unsupported is **never** shown as data, even if a synthetic row set exists.
- `NOT_CONNECTED` — live runtime → honest block (see below).

## Protected-dimension guard

`age` and `gender` are `PROTECTED_DIMENSIONS` in `intelligence/audience.ts`. The explorer shows their
distribution for transparency but renders a clear "reported only — never used as a targeting exclusion"
note and presents **no actionable recommendation**: `analyzeBreakdown` returns `actionable: false` and no
`efficiencySpread` for them, and the view surfaces that directly. The guard is asserted end-to-end in
`test/breakdown-explorer.test.ts`.

## What is NOT real (honest scope)

- **No provider feeds breakdowns into the normalized `ReportRow` path.** Every reachable dimension is at
  best `RAW_ONLY` (reachable via a raw passthrough tool on meta / tiktok / reddit). Nothing is `READY`.
- **Live runtime shows `NOT_CONNECTED`**, never demo content: "breakdowns are not in the normalized
  report path for any provider (raw export only)". `loadBreakdownExplorer` returns `connected: false` for
  the live branch and surfaces no rows.
- **Phase C candidate**: wire the raw breakdown tools into a canonical `BreakdownObservation` rows path
  (`intelligence/model.ts` already defines the type), which would let a dimension become `READY` and flow
  real data into this exact surface with no UI change.

## B25 — attention-queue transparency

The attention/opportunity ranking is deterministic and now **exposes why each item is prioritized** —
contributing factors, not an opaque AI score.

- `intelligence/opportunity-center.ts`: the old scalar `materiality()` is replaced by
  `materialityBreakdown(severity, spendShare, confidence, dataTrust)`, which returns the **same total**
  (ordering is unchanged) plus the named factor contributions — severity base, spend-share lift, and the
  confidence / data-trust discounts (reported as the points they removed). `AttentionItem` now carries
  `factors: MaterialityFactor[]`. Ordering gains a stable `entityId` tie-break so it is fully
  deterministic.
- `orchestrator/sections.ts` `buildPortfolio` (the agency "client health queue" that is actually
  rendered): each client row carries `factors: AttentionFactor[]` — each deterministic signal
  (stale sync, CPA deterioration, creative fatigue, platform-vs-merchant variance, pending outcome) with
  its explicit point contribution. The score is their sum. The agency surface (`SectionView` `portfolio`
  case) renders each factor with its `+N` points, so the ranking is explained in the UI.
- Tests: `test/attention-transparency.test.ts` asserts the factors reconstruct the score, each ranked
  item carries its reasons, and the ordering is deterministic (trustworthy outranks SYNTHETIC/low-conf;
  equal scores tie-break stably).
