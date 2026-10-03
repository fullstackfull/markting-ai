# 02 — Creative — DONE (library) / PARTIAL (detail, intelligence dashboard)

- **Creative Library** (`app/dashboard/creative`) — DONE. Per-creative rows with state (NEW/STRONG/
  FATIGUE_WATCH/UNDERPERFORMING/INSUFFICIENT_EVIDENCE), CTR-trend fatigue signal, spend concentration,
  and hook aggregation; computed by the real engines (`classifyTrend` over CTR/frequency series). Small
  samples are INSUFFICIENT_EVIDENCE, never labelled "loser".
- **Creative detail page** and a dedicated **Creative Intelligence dashboard** (hook/angle/format
  performance as standalone views) — PARTIAL: hooks aggregation + per-creative rows exist in the library;
  a per-creative detail route and separate dashboards were not built. Multimodal stays UNKNOWN (no live
  multimodal model) — never fabricated.
