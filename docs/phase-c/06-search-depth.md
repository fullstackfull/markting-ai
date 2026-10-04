# C — Search intelligence depth

**Honesty preamble.** No live Google Ads (or other search) credentials exist in this environment. Live
search reads/writes are **`BLOCKED_EXTERNAL`** and unverified. Nothing below was observed from a real
account.

## Review-for-negative-keyword only — NEVER auto-add

Search-term mining in this platform is a **review surface, not an automated action**. The search-term
report that would surface candidate negative keywords is a thing a human reviews; the platform does not,
and must not, add negatives on its own.

- **No autonomous write path exists.** The runtime-mode type has no autonomous-write member; apply is
  refused outside `DEMO` / `LIVE_WRITE_APPROVAL_ONLY` (`docs/phase-c/14-security-review.md` item 11;
  `lib/markting/runtime-mode.ts:7-41`). Keyword/negative mutations exist in the Google adapter
  (`planAddKeywords` with `negative`, `planSetKeywordStatus`, `planRemoveKeywords` —
  `platform/packages/google/src/provider.ts:551-620`) but are **write tools behind the full governed
  path** (recommendation → preview → human approval → apply → audit), never fired from analysis.
- **Mode B stays HELD.** Enabling writes is a separate, deliberate human action gated by
  `MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY`, which the readiness review cannot set, and no action
  can honestly reach `READY_FOR_PRODUCTION_APPROVAL` while live prerequisites are `BLOCKED_EXTERNAL`
  (`lib/markting/ops/mode-b-readiness.ts:5-17`). Recommendations are `REVIEWABLE`; accepting one only
  moves it to `ACCEPTED_FOR_PREVIEW` and mutates nothing
  (`lib/markting/intelligence/recommendation.ts:6`).

## No normalized keyword/search_term breakdown is wired today

The capability registry is the single source of truth, and for Google it marks the search dimensions as
**`NOT_SUPPORTED`**: `keyword`, `search_term`, `network`, `device` (`lib/connections/registry.ts:120`).
`NOT_SUPPORTED` here means the normalized `ReportRow` report path does **not** produce these segments at
all — no provider is `READY` on any breakdown dimension (`registry.ts:48-52,113-117`). A raw GAQL
passthrough (`gaqlSearch`, `provider.ts:236-250`) can query search-term views directly, but that is not
the canonical normalized path and is not surfaced as a report breakdown.

Consequence: the search-term mining surface, when it exists, is fed by a **raw/explicit query**, not by
the normalized breakdown pipeline. Do not describe it as a wired normalized dimension.

## What the review surface is (and isn't)

- **Is:** a place to review candidate negative keywords a human may then choose to add via the governed
  preview→approve→apply flow, each with a server-side `validate_only` dry run (`provider.ts:252-262`).
- **Isn't:** an automated negative-keyword adder, a continuous optimizer, or a normalized breakdown
  report. No search-term row reaches a surface in a live posture today because the live transport is
  unverified.

## Live gatherer

With credentials, Google rows flow adapter → validate → normalize `PLATFORM_REPORTED` →
`analyzeAccount` (`lib/cloud/live-gatherer.ts:81-130`) — but only at the four hierarchy levels, never as
keyword/search-term segments. With none connected, the surface is `NOT_CONNECTED`
(`reads.ts:59-60`, `live-gatherer.ts:97-99`).

**Status:** search-term mining is a **review-for-negative-keyword surface, never an auto-add**; no
normalized keyword/search_term breakdown is wired (`NOT_SUPPORTED`); Mode B write control stays **HELD**;
live search is **`BLOCKED_EXTERNAL`** (no credentials, unverified).
