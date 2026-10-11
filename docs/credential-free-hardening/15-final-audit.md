# 15 — Pre-live six-lens self-audit (item 43)

A pre-live adversarial review of the Phase C.6 surface from six lenses. Each finding was checked against
the **actual code** (not the description). Severity: P0 (blocks live), P1 (fix before scale), P2 (follow-up),
OK (verified sound). No new P0/P1 found; the posture holds.

## Lens 1 — SRE / reliability

- **OK** — Pagination is bounded on every axis (maxPages, maxRows, deadline, abort, repeated-cursor
  LOOP_DETECTED). Verified by the load/soak suite: a 10k-cycle soak keeps limiter state constant (no
  unbounded growth), and the maxRows cap stops *exactly* at the ceiling.
- **OK** — The executor never blind-retries an unclassified throw: it maps to `UNKNOWN / AMBIGUOUS` and the
  worker parks it. Chaos suite confirms no fault yields a false SUCCESS.
- **OK** — Health is fail-honest: an absent probe signal is `UNKNOWN`, never fabricated `HEALTHY`.
- **OK** — DR restore-manifest validation fails closed; crash recovery reconciles before retry when a
  double-write risk exists.
- **P2 (INFRA)** — The real metrics/trace backend (OTLP) and backup execution are BLOCKED_EXTERNAL stubs by
  design; wiring + a real soak against production infra is a deployment step, tracked in the blocker
  register.

## Lens 2 — AppSec

- **OK** — No raw-secret leak path in the new ops modules: a scan for `console.*` / payload logging found
  only comments and the rate-limiter's (non-secret) token counter. `evidence` strings are terse codes.
- **OK** — Admin surfaces never select a raw secret column and never touch the `private.*` schema where
  tokens live (pinned by `admin-secret-safety.test.ts` against the real source).
- **OK** — OAuth hardening exercises the real PKCE (S256; verifier never on the URL), single-use hashed
  state, origin-anchored redirect URI, and open-redirect defense.
- **OK** — Webhook secrets: plaintext is never persisted or logged; an unseal failure re-wraps to a
  secret-free message; a missing secret resolves to `null` (NOT_CONFIGURED), never a fabricated key.

## Lens 3 — Privacy

- **OK** — DSAR plans are reviewable and perform no deletion; immutable audit/compliance classes are
  `RETAIN_IMMUTABLE`, and a hard runtime invariant **throws** if ERASE/PSEUDONYMIZE is requested on an
  immutable class — verified at the execution step, not just the plan.
- **OK** — PII classifier blocks any DIRECT_IDENTIFIER/SENSITIVE/PAYMENT field from a model-bound
  projection; commerce PII reduction (pseudonymous id + dropped identity/free-text) is unchanged.
- **OK** — AI output validator scans for secret-leak and instruction-leak before output is trusted.

## Lens 4 — Integration architect

- **OK** — Every provider read passes the source-mode + connection-active guards *before* any I/O; a
  disabled/revoked connection yields non-retryable `REAUTH_REQUIRED`.
- **OK** — The connection state machine forbids illegal transitions (CONNECTED only via CONNECTING or a
  recovery edge); recovery is a pure, exhaustive condition→action map tied to the state machine by test.
- **OK** — Normalization prep is DOCUMENTATION_DERIVED, maps to canonical keys consumed by the existing
  `normalizeReportRow`, and never infers FX. Schema drift/versioning classifies COMPATIBLE/MINOR/BREAKING.
- **OK** — Commerce transport is read-only by construction (no mutating verb representable); replay
  contracts assert merchant-truth-only (no COGS/revenue from ad conversion value).

## Lens 5 — Media buyer / product correctness

- **OK** — Search intelligence is REVIEW_ONLY: `reviewOnly:true` literal + a compile-time `NoAutoApply`
  guard + `SEARCH_DIAGNOSTICS_MODE='REVIEW_ONLY'` — auto-apply is unrepresentable.
- **OK** — Social fatigue requires ≥2 independent signals; a single signal is at most WATCH.
- **OK** — No autonomous writes anywhere: Mode B HELD, autonomous optimization DISABLED, creative pipeline
  `published` always false, AI adapter has no write verb.
- **OK** — Cost budgets use admission control (hard stop at cap, never silent overspend); rate-limit
  defaults are conservative protective ceilings.

## Lens 6 — Red team

- **Attempted bypass: enable a live-write via feature flag** → blocked. `HARD_PINNED_CATEGORIES`
  (live_write, autonomous_optimization, live_model) are excluded at compile time (`EnableableFlagKey`) and
  rejected at runtime.
- **Attempted bypass: flip autonomous optimization default ON** → blocked. The default type has a single
  inhabitant (`'DISABLED'`); `'ENABLED'` is always a CRITICAL violation no opt-in can clear.
- **Attempted bypass: smuggle a live model through the AI adapter** → blocked. The real adapter is a
  BLOCKED_EXTERNAL stub that throws; the fake records as local fallback; neither reaches a provider.
- **Attempted bypass: erase audit evidence via DSAR** → blocked (hard invariant throw).
- **Attempted bypass: pass a provider read while source mode is DEMO** → blocked by the source-mode guard
  before any I/O.
- **OK** — No path discovered that performs a live provider call, a provider write, or a live model
  activation without real credentials + an explicit, audited, currently-HELD opt-in.

## Verdict

No open P0/P1. The only material remaining blocker is credentialed live verification (see the blocker
register). The code-solvable, credential-free hardening surface is complete and internally consistent.
