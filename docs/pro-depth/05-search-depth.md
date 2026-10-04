# 05 — Search / Google depth (honest scope)

## What is real
The Google adapter returns rows at all four levels — account, campaign, **ad group**, ad — with the 10
canonical metrics (including conversions, conversion_value and ROAS). So the drill-down and the
deterministic diagnosis work for Google at campaign → ad group → ad exactly like the social providers,
with the provider-native term "Ad group".

## What is NOT real (and is not faked)
- **keyword-level reporting**: NOT a report dimension. The Google adapter exposes keywords only as
  **write/entity** operations (add/pause keyword, create RSA) — there is no keyword row in the
  normalized report path. The registry marks `keyword: NOT_SUPPORTED`.
- **search-term reporting**: same — NOT_SUPPORTED in the report path.
- **match type, impression share, PMax asset-group / product-group reporting**: NOT_IMPLEMENTED as
  report dimensions. We do **not** build a search product on fields the adapter does not expose.

## Search-waste analysis (B14) — deliberately NOT shipped
Deterministic search-term waste analysis (spend with no/low-value conversions → recommend review)
requires search-term rows, which the normalized path does not carry. Rather than fabricate it on
unavailable data, this is documented as a **Phase C candidate** (wire the google search-term/keyword
report into a canonical rows path, then run the waste heuristic). Mode B remains HELD regardless: even
with the data, the product would only ever **recommend review** of candidate negatives — it would never
auto-add negative keywords.

## Net
Google search depth is materially improved at the hierarchy level (campaign → ad group → ad diagnosis),
and explicitly honest that keyword/search-term/PMax reporting is not available yet.
