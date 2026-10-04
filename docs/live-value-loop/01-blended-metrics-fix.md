# 01 — Blended Conversions Headline (A1)

**Problem (council MATERIAL):** the Overview tile summed provider-claimed conversions across providers into
one number and showed a single-currency blended ROAS — mixing incompatible conversion definitions /
attribution windows / dedup, the exact error the library's own cross-channel gate forbids.

**Fix:** `lib/cloud/live-summary.ts#summarizeLiveRows` (pure, tested) — impressions/clicks are raw delivery
counts (safe to sum); **conversions and ROAS are kept PER PROVIDER** (never summed/blended across providers);
spend is summed only within a currency (never across — no invented FX). `app/dashboard/live-data.tsx` renders
per-provider conversions + per-provider ROAS (suppressed when a provider spans multiple currencies). i18n
foot labels (`lib/i18n/messages/overview.ts`) now disclose "platform-attributed, per provider · not additive
across providers". Regression test: `test/live-summary.test.ts`.
