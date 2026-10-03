# 08 — UI Design System — PARTIAL

## What was done

The new surfaces (Workspace, Recommendation Center) reuse the existing centralized primitives
(`components/ui.tsx`: `PageHeader`, `Empty`, `Provider`, status chips; `globals.css` tokens) so they are
visually consistent with the rest of the app, bilingual, and RTL-correct (logical CSS + `BiText`/locale).
New semantics introduced consistently on these surfaces:

- **Next-action** chips (ATTENTION/INVESTIGATE/REVIEW/EXPERIMENT/MONITOR/…) with severity tones.
- **Data trust** and **answer source** shown as distinct chips (not conflated with risk).
- **Domain availability** chips (CONTRIBUTED vs NOT_CONNECTED) for honest empty states.

This begins the Program-13 separation of the overloaded "Risk" concept into distinct visual semantics
(Recommendation Risk vs Data Trust vs Confidence vs Operational Severity): the orchestrator models these
as separate typed fields, and the new surfaces render them as separate chips.

## What remains — NOT_STARTED

A formal design-system pass (Program 13): shared chart/sparkline/gauge/recommendation-card primitives
(the library still has no data-viz primitive), a unified empty/loading/error-state kit, and applying the
distinct Risk/Trust/Confidence/Severity chip system across all legacy pages. Mobile reflow of dense
tables (Program 15) and a full accessibility pass with automated CI checks (Program 16) are also
NOT_STARTED. The new surfaces are responsive and use semantic chips, but the systematic design-system
and a11y programs were not completed.
