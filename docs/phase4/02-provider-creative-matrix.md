# 02 — Provider Creative-Support Matrix (4B)

Audited from the provider packages (carried from the Phase-2 read-capability audit, doc phase2/09,
narrowed to CREATIVE fields). **No live provider creative data is available in this environment**, so
ingestion is **SYNTHETIC_PROVEN** (fixtures through the same `creative/model.ts` normalization
boundary a live read would use); live transport is **BLOCKED_EXTERNAL**. Nothing is claimed as live.

Legend: **✓** typed/dedicated read · **✓ᵍ** reachable only via the provider's generic API-passthrough
read tool (not first-class) · **✗** not exposed/implemented.

| Provider | Creative ID | Media metadata | Copy/text | Thumbnail | Image | Video | Performance | Placement | Ad linkage | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| meta | ✓ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ | ✓ | ✓ | ✓ |
| tiktok | ✓ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ | ✓ | ✓ | ✓ |
| google | ✓ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ | ✓ | ✓ | ✓ |
| snapchat | ✗ (stat ids) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | partial | ✓ |
| apple | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✗ | ✗ | ✗ | ✓ (campaign) | ✗ | ✓ᵍ | ✓ |
| microsoft | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (campaign) | ✗ | ✓ᵍ | ✓ |
| reddit | ✗ᵍ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ᵍ | ✓ |
| pinterest | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ |
| linkedin | partial (creative-id rows) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ |
| x | ✓ (internal) | ✓ (internal) | ✗ | ✗ | ✗ | ✗ | ✓ (spend/impr/clicks) | ✗ | ✓ | ✓ |
| spotify | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ |

## Honest reading

- **Priority providers (Meta/TikTok/Google):** creative id + performance + ad-linkage + status are
  first-class; media metadata / copy / thumbnail / image / video are reachable **only via generic
  passthrough** today (`✓ᵍ`) — the normalized creative ingestion maps them when present but they are
  not claimed as first-class typed reads. Snapchat exposes creatives only as stat ids (no asset/copy).
- Typed creative-read additions (Meta/TikTok typed creatives) remain **staged** (carried from Phase 2)
  — not implemented here; the matrix is not overstated.
- The ingestion path, normalization, dedup, clustering, classification, performance, fatigue, and
  recommendations are all provider-agnostic: they run on the canonical `Creative`, so once a provider's
  creative fields are wired they flow through unchanged. Proven on fixtures (SYNTHETIC_PROVEN).
