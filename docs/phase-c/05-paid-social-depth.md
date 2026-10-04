# C — Paid social depth (Meta / TikTok / Snapchat)

**Honesty preamble.** No live credentials exist for any paid-social provider in this environment. The
adapters implement live transport (`liveTransportImplemented: true`, `registry.ts:99`), but every
contract fixture is `DOCUMENTATION_DERIVED` or `SYNTHETIC` — there are **zero live-captured cassettes**
(`test/fixtures/connection-contract-provenance.ts:25,26,30`). Live depth is therefore
**`BLOCKED_EXTERNAL`**; nothing below was observed from a real account.

## Native ad_group term per provider

The canonical "ad_group" level carries a provider-native label (`registry.ts:56-57`):

| Provider  | Native term | ar | Source |
|-----------|-------------|----|--------|
| Meta      | **Ad set**  | مجموعة إعلانية | `registry.ts:119` |
| TikTok    | **Ad group**| مجموعة إعلانية | `registry.ts:121` |
| Snapchat  | **Ad squad**| سرب إعلاني | `registry.ts:126` |

`adGroupTerm(providerId)` resolves these so the UI never mislabels the level (`registry.ts:219-221`).

## Breakdown support per the registry

Dimensions default to `NOT_SUPPORTED` when absent, and **no provider is `READY`** on any dimension —
RAW_ONLY means reachable via a raw passthrough tool but **not** fed into the normalized `ReportRow`
(`registry.ts:48-52,113-117`):

- **Meta:** `placement`, `device`, `geography`, `age`, `gender` = **RAW_ONLY** (`registry.ts:119`).
- **TikTok:** `placement`, `device`, `age`, `gender` = **RAW_ONLY** (`registry.ts:121`).
- **Snapchat:** `dimensions: {}` → **all NOT_SUPPORTED**; levels are `PARTIAL_DEEP` (account/campaign
  `READY`, ad_group/ad `PARTIAL` = rows but id-only names) (`registry.ts:110,126`).

## Creative fatigue requires MULTIPLE signals

Creative analysis is a deterministic **foundation**, explicitly **not** multimodal understanding, and a
declining CTR alone is labelled a *signal, never proof* (`lib/markting/intelligence/creative.ts:1-6`).
The fatigue verdict logic (`creative.ts:86-102`):

1. **Gate:** needs `impressions ≥ minImpressions` (default 1000) and a CTR series of ≥5 points, else
   `INSUFFICIENT_DATA` (`creative.ts:87-89`).
2. **Signal 1 — CTR decline:** early-half vs recent-half mean; a ≥20% drop is "declining"
   (`creative.ts:90-94`). No decline → `NO_SIGNAL`.
3. **Signal 2 — frequency rise:** a decline is only elevated to **`FATIGUE_SIGNAL`** when
   `frequency > frequencyContext` — i.e. CTR decline **and** repetition context together
   (`creative.ts:96-101`). A decline without the frequency signal stays **`NOT_PROVEN`** (cause could be
   audience/seasonality).

So `FATIGUE_SIGNAL` is reserved for the two-signal case and is still worded as a signal, never proven
causation (`creative.ts:81,99-101`). Ad copy is treated as **DATA only**, never an instruction
(`creative.ts:5,15`). Spend concentration (HHI) and CPA dispersion are additional structural signals
(`creative.ts:56-68`).

## Live depth posture

Depth reads (ad-set / ad-group / ad-squad level rows, breakdowns, creative series) would flow through the
live gatherer's best-effort lower-hierarchy reads (`live-gatherer.ts:86-92`), but with no connected
provider they return empty and the surface stays `NOT_CONNECTED` (`reads.ts:59-60`,
`live-gatherer.ts:97-99`). No write controls are exercised — writes stay behind preview + Mode-B hold
(`registry.ts:30`).

**Status:** paid-social adapters implement live transport, but live depth (breakdowns + creative series)
is **UNVERIFIED → `BLOCKED_EXTERNAL`** (no credentials); fatigue requires CTR-decline **and**
frequency-rise, reported as a signal, never proof.
