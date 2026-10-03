# 08 — Provider & Commerce Health (PARTIAL / roadmap)
Per-org connection status (3-state + last error) is shown on an org's detail page. A cross-tenant provider fleet
view (healthy/expired/revoked/rate-limited/outage, token-expiry forecast) and a commerce fleet view (failing/stuck
stores, webhook failures, sync lag, COGS coverage) are roadmap Waves 10-11; `/admin/providers` and `/admin/commerce`
are PARTIAL stubs. No provider tokens/secrets or customer PII are exposed.
