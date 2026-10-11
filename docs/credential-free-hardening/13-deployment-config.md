# 13 — Deployment hardening + config validation + safe defaults (items 36, 37, 38)

Files: `lib/markting/ops/deployment-hardening.ts`, `lib/markting/ops/config-validation.ts`,
`lib/markting/ops/safe-defaults.ts` + `test/deployment-config.test.ts`, `test/safe-defaults.test.ts`.

## Deployment hardening (item 36)

`evaluateDeploymentReadiness(facts, opts)` → `{ready, checks:[{id, severity, pass, reason}]}` over injected
deployment facts (required config valid, HTTPS enforced, secure cookies, RLS enabled, backups configured,
migrations applied, kill-switch default-safe, Mode B held, autonomous optimization disabled, debug
disabled, runtime mode, security headers, readiness probe). It **fails closed**: any absent critical fact
→ `pass:false reason:'unknown'` and not ready (readiness is never assumed). `EXPECTED_SAFE_DEPLOYMENT` is
derived from `SAFE_DEFAULTS` so the deployment model and the runtime defaults cannot diverge.
DOCUMENTATION_DERIVED constants: `REQUIRED_SECURITY_HEADERS`, `SECURE_COOKIE_FLAGS`,
`PRODUCTION_SAFE_RUNTIME_MODES`.

## Config validation (item 37)

A pure SHAPE validator over an injected `ConfigMap` (**never** `process.env`). A typed `FieldSpec` schema
(required / prod-only-required; formats: url, origin, enum, boolean-enum, key-length-band, integer-band;
secret; demo-fixture) → deterministically ordered `ConfigError[]`. A **redacted echo** proves a value is
present (presence + coarse length band) **without revealing it** — a secret length error says "length
outside the expected band" with no number. Production vs dev profiles (prod requires secrets, disallows
demo fixtures). Generalizes `env.ts` (`keyof MarktingEnv`) without duplicating its exports.

## Safe defaults (item 38)

Frozen `SAFE_DEFAULTS`: runtime mode `DEMO`, `modeB:'HELD'`, `autonomousOptimization:'DISABLED'`,
`providerWrites:'OFF'`, `liveModel:'OFF'`, global write halt on (kill-switch default-safe), non-verbose
logs, conservative rate-limit/cost defaults. `assertSafeDefaults(config)` → `{safe, violations}` flags any
dangerous flip lacking a **complete audited opt-in** (`approvedBy` + `ticket` + `reason` + `at`, all
non-blank). Two hard guards: the `AutonomousOptimizationDefault` type has a single inhabitant
(`'DISABLED'`), so "autonomous write default ON" is **unrepresentable** cast-free; and at runtime
`autonomousOptimization:'ENABLED'` is **always** a CRITICAL violation no opt-in can clear. Mode B HELD and
autonomous DISABLED are the enforced safe defaults.
