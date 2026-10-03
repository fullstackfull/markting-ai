# 09 — Benchmark re-run & honest classification (Program 27)

Source: `lib/markting/orchestrator/benchmark.ts` (50 questions) · evidence: `test/benchmark.test.ts`
(executable, runs in CI).

## Result: **42/50 ANSWERABLE_NOW**

A question counts ANSWERABLE_NOW only if (a) a shipped product surface answers it, or (b) the Assistant
answers it AND a `check` predicate asserts the **real computed section/diagnosis** is present. No
question is counted on a backend function's existence alone. The test also fails if any assistant
question's check silently fails (an inflated mapping).

## The 8 not-now questions — every one classified (machine-checked)

The test asserts every `agent-only`/`none` question carries a `notNow` class; the distribution is:

| Class | Count | Questions |
|---|---|---|
| `REQUIRES_PROVIDER_CAPABILITY` | 4 | #23 search terms (GAQL), #25 impression share, #26 PMax asset-group, #36 attribution-window sensitivity |
| `INTENTIONALLY_UNSUPPORTED` | 3 | #29 bid-strategy change, #30 create campaign, #31 launch RSA (all **writes**, held) |
| `NOT_SUPPORTED_BY_PRODUCT` | 1 | #24 negative-keyword suggestions (would be a new intelligence capability) |

## Why 45 is not honestly reachable here

Converting any of the 8 would require exactly what this program forbids:
- the 4 `REQUIRES_PROVIDER_CAPABILITY` need **live providers / provider reads we don't normalize** — no
  credentials, so faking them would be dishonest;
- the 3 `INTENTIONALLY_UNSUPPORTED` are **write/mutation** actions deliberately held (Mode B off,
  autonomous optimization off);
- the 1 `NOT_SUPPORTED_BY_PRODUCT` would need a **new intelligence feature**, which is out of scope
  ("Do NOT begin another intelligence phase", "Do NOT implement fake shallow intents just to hit 45").

So the honest number is **42/50**, and the primary exit target's qualifier — *"≥45 only if honestly
achievable without live credentials"* — is satisfied by classifying the remainder rather than inflating
the count. Gate: **ANSWERABLE_NOW = 42/50, honest, no fabrication.**
