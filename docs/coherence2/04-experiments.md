# 04 — Experiments & Scenarios — DONE (review-only)

`app/dashboard/experiments` renders three sections from the real engines: the experiment workbench
(proposed/active with hypothesis + readiness from the sample-sufficiency engine), the budget-scenario
review (`allocateExtra` → Conservative / Balanced / Aggressive-review with candidate signals: target,
saturation, fatigue, inventory risk), and saturation/marginal (`fitResponseCurve`/`detectSaturation`/
`marginalMetrics`). Nothing launches automatically; no provider is mutated — review only.
