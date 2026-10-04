# 07 — Date / Time Range + Timezone + Freshness (A6)

**Range resolver (`lib/cloud/date-range.ts`, pure/tested):** presets today / yesterday / last_7 / last_14 /
last_30 + custom window; returns the current window AND an equal-length immediately-preceding `previous`
window for period-over-period comparison. Day boundaries are computed in the account/org IANA timezone when
known; when unknown it falls back to UTC and sets `timezoneFallback` so the surface states the fallback
explicitly (never silently treats a UTC day as a business day). Tests: `test/date-range.test.ts` (incl. a
Riyadh UTC+3 boundary case and the fallback flag).

**Propagation:** the `range` search param flows through the shared loaders
(`loadWorkspaceIntelligence`/`loadSection` → `serviceForMode` → `createLiveGatherer`) so every surface
resolves the SAME window — no per-surface window. The timezone source is the tenant business context
(`loadBusinessContext`), honestly UNKNOWN → UTC fallback when unset.

**UI:** `components/range-control.tsx` (preset chips + custom from/to) and `components/freshness-bar.tsx`
(discloses selected window, comparison window, timezone + fallback note, source/provenance LIVE vs
DEMO, and last-refresh). Wired on the workspace and account surfaces.
