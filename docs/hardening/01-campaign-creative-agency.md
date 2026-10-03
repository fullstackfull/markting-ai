# 01 — Campaign / creative drill-down, agency switching, depth (Programs 1–7)

Delivered in H1 (`695b547`) on top of the coherence surfaces.

## Campaign route (Programs 1–2)
- `app/dashboard/accounts/[accountId]/campaigns/[campaignId]/page.tsx` — the media-buyer drill-down for
  one campaign, composed from the orchestrator (no independent campaign analytics): KPIs,
  current-vs-previous half, pacing, CPA trend, scaling readiness, creative health, and an experiment
  entry point. Charts: `PacingChart` + a current-vs-previous `BarChart`.
- `buildCampaign(acc, campaignId)` in `lib/markting/orchestrator/sections.ts` (CampaignSection); loaded
  via `loadCampaign` in `lib/cloud/intelligence.ts`. Navigation: account page lists campaigns, each row
  links to the campaign; the campaign page links back to experiments.

## Creative detail (Programs 3–4)
- `app/dashboard/creative/[creativeId]/page.tsx` — lifecycle, fatigue evidence, a test idea, and
  `multimodal = 'MULTIMODAL_NOT_CONFIGURED'` (honest: no multimodal analysis is configured). From
  `buildCreativeDetail(acc, creativeId)`. Creative names across surfaces are `EntityLink`s to this route.

## Agency client switching (Program 5)
- `components/client-switcher.tsx` — a **navigation-based** switcher (server component). It changes which
  account the surfaces read; it does not merge data across clients, so there is no cross-client leakage.
  Returns `null` in live mode (demo seed only). Portfolio rows link to each client's account.

## Agency portfolio + executive depth (Programs 6–7)
- `buildPortfolio` ranks clients by an attention score composed from real signals (stale sync, CPA
  trend, creative fatigue, reconciliation variance, pending outcomes). Portfolio **never blends
  currencies** — each client keeps its reporting currency; benchmark #38 asserts this.
- Executive surface composes the same orchestrator output at a portfolio level with evidence links.

Evidence: `test/benchmark.test.ts` (#5 campaign diagnosis, #18/#38 portfolio, #19/#20/#50 creative),
`test/orchestrator*.test.ts`, and the authored E2E journeys E2E-01/02/04 (see doc 04).
