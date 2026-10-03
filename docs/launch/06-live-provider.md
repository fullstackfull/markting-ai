# 06 — Live Provider Read (Stage 9) — BLOCKED_EXTERNAL

No live provider OAuth credentials or a dedicated test ad account exist here. The full read pipeline
(OAuth → connection → account → campaigns → metrics → normalization → data trust → analysis →
recommendations → memory/outcomes) is built and exercised against the typed provider boundary with
fixtures (FIXTURE_PROVEN across Phases 1–6). The live legs (OAuth handshake, real metric read,
rate-limit behaviour) are HELD until a provider test account + credentials are supplied; priority order
for connection is Meta → Google → TikTok → Snapchat. No provider write is in scope here regardless.
