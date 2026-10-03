# 02 — Core data-viz chart primitives (Programs 8–9)

Delivered in H2 (`e7d0882`). File: `components/charts.tsx` (server components, no client JS).

## Primitives
- `TimeSeriesChart` — line over a numeric series; shows an **insufficient-data** state below 3 points.
- `BarChart` — horizontal bars; serves contribution, breakdown, comparison and scenario. Dual-series
  (`twoSeries`) uses color **plus a hatch pattern** (secondary encoding) so it is CVD-safe without a
  palette validator, and prints a "solid = current, hatched = previous" legend.
- `FunnelChart` — decreasing stages (delegates to BarChart).
- `PacingChart` — elapsed-vs-spent gauge.

These cover the required families: TimeSeries, PeriodComparison (BarChart twoSeries), Contribution,
Funnel, Pacing, ScenarioComparison and Breakdown (BarChart variants).

## Accessibility (ties into doc 03)
Every chart ships: a title + unit, an SVG `<title>`/`<desc>`, a **visible text summary** (so the
finding is never color-only), an empty state, an insufficient-data state, native per-mark hover
tooltips (`<title>` elements), and a legend for ≥2 series. Numeric axes render LTR (the app forces
Latin numerals); surrounding labels follow locale/RTL.

## Integration (Program 9)
Charts are wired into real surfaces: the campaign page (pacing + current-vs-previous), commerce
(profit-signals bars), and the section renderer. The design follows the `dataviz` skill method:
form chosen by the data's job, one axis (never dual-axis), categorical identity never color-alone,
status colors reserved and never reused as a series color.

Honest limitation: the palette was not run through the `dataviz` validator script in CI; CVD-safety is
achieved structurally via the hatch secondary-encoding + text summaries rather than a measured ΔE.
