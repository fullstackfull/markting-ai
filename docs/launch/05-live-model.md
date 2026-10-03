# 05 — Live Model (Stage 8) — BLOCKED_EXTERNAL

No approved live model credentials are configured for the product's governed gateway in this
environment. (The agent runtime's own ANTHROPIC/AWS variables are NOT the product's configured gateway
and were deliberately NOT repurposed as a "live model test" — that would be a false success claim.)

Proven WITHOUT a live model: the governed `AiGateway` (allowlist, org attribution, request id, token
capture, cost estimate, timeout, retry, local fallback, quota, injection controls) + the deterministic
engines remain authoritative for all calculations; the model only narrates over governed data; bilingual
(en/ar) output is produced by the deterministic narration paths and exercised across the Phase-1..6 eval
suites. Live narration quality (Stage-8 Arabic/English checks against a real model) is HELD until a live
model is connected. When connected, the Phase-1..6 eval suites run against live narration as a gate;
calculations stay deterministic.
