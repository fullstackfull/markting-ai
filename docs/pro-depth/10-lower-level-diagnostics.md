# 10 — Lower-level diagnostics & contribution analysis

## Same engine, more levels (B12)
`analyzeAccount` descends campaign → ad_group → ad using the SAME level-generic `diagnoseEntity`
(every diagnosis type — SPEND_*, CONVERSION_*, CPA_*, ROAS_*, CTR_*, CPM_PRESSURE, CPC_PRESSURE,
FUNNEL_STAGE_COLLAPSE, DATA_QUALITY_ISSUE, ANOMALY, …) now applies at group/ad level automatically,
each carrying its own `scope.entityLevel` and an `EvidenceRef` (raw values + calculation, never model
prose). No hard-coded recommendation text anywhere.

## Contribution decomposition (which child drove the move)
For each parent node the engine runs `campaignContribution(children_current, children_previous,
'spend')` and attaches `childContribution` — each child's absolute spend delta over the sum of absolute
deltas (well-defined even when children move in opposite directions). This answers the media-buyer
questions directly:
- *What changed?* → the parent's own diagnoses.
- *Which child contributed most?* → `childContribution[0]`.
- *Is spend concentrated?* → the share distribution (the cross-campaign HHI concentration helper also
  applies).
- *Did efficiency worsen, and where?* → per-child CPA/ROAS diagnoses.
- *Is one ad set / ad dragging performance?* → the child node whose CPA_DETERIORATION / conversion
  decline is largest.

## Causal restraint
- Contribution is reported as **spend-movement share**, not a causal claim.
- A monetary contribution across children that span multiple currencies returns
  INSUFFICIENT_EVIDENCE rather than blending units.
- Ratio diagnoses rest on a conversion sample-size floor; below it the engine emits
  INSUFFICIENT_EVIDENCE, not a verdict.
- No child nodes are produced without child observations — depth never invents entities.

## Tested
`test/hierarchy-depth.test.ts` locks: campaign→ad_group→ad nesting with provider-native type,
contribution presence, lower-level diagnoses at the correct `entityLevel`, and the no-fabrication
guarantee.
