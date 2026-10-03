# 10 — Design System & Charts — PARTIAL

- **DONE:** a reusable server-side `SectionView` (`components/intel.tsx`) renders every orchestrator
  AnswerSection consistently across all persona surfaces, plus an `IntelMeta` header (trust + answer
  source + demo marker). Status/trust/next-action are distinct typed chips (beginning the Program-13
  separation of Risk vs Trust vs Confidence vs Severity). Reuses the existing `ui.tsx` primitives +
  `globals.css` tokens; bilingual/RTL; no client JS.
- **NOT_STARTED:** a formal component kit (MetricCard/EvidenceCard/RecommendationCard/TrustIndicator/
  Timeline/ChartShell as named exports) and **data-visualization primitives** (time-series, period
  comparison, contribution, pacing, funnel, scenario charts). Today sections render as tables + labelled
  values, not charts. This is the largest remaining UI increment.
