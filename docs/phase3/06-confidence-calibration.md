# 06 — Learning Signals & Confidence Calibration (3K / 3L)

`learning.ts`.

## Learning signals (3K)

Deterministic aggregations the AI may use as CONTEXT — acceptance rate, rejection reasons, positive/
negative alignment, category and provider effectiveness, confidence distribution. They **do not**
self-modify any policy rule, confidence definition, or safety gate. The AI consumes them; it never
rewrites itself.

## Confidence calibration (3L)

`calibrateConfidence()` asks whether HIGH-confidence recommendations actually align with outcomes more
than MEDIUM/LOW. Per level it reports measured count, positive-aligned count, and alignment rate. It
returns:
- `INSUFFICIENT_HISTORY` when any level is under-sampled (default `minSamplePerLevel = 10`) — it
  reports insufficiency rather than a misleading number;
- `WELL_CALIBRATED` only when there is enough history AND HIGH ≥ MEDIUM ≥ LOW alignment;
- `MISCALIBRATED` otherwise.

It never changes confidence definitions to improve a headline metric. Contaminated / insufficient-data
outcomes are excluded from calibration so a confound cannot flatter or punish a confidence level.
