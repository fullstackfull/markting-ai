# Phase 2 report — Arabic first, RTL

Date: 2026-10-02. Scope: the adport cloud app (`platform/apps/cloud`). Arabic is the default UI language and renders right-to-left; English is one click away. Ad terms (ROAS, CPA, CTR, CPC, CPM) stay in English in both languages.

## 1. What was built

| Piece | Where | Notes |
| --- | --- | --- |
| Locale resolution | `lib/i18n/config.ts`, `lib/i18n/server.ts`, `app/api/locale/route.ts` | Cookie `markting_locale` → `Accept-Language` → Arabic. `<html lang dir>` is set in the root layout. A `LocaleSwitcher` (sidebar foot and sign-in footer) stores the choice and re-renders the server tree. |
| Dictionaries | `lib/i18n/messages/*.ts` (18 areas, `{ en, ar }` with identical keys) | ~560 keys. Server components use `getT()`; client components use `useI18n()` (English fallback outside the provider, which keeps upstream unit tests meaningful). Plurals use `Intl.PluralRules` with the six Arabic categories. |
| Converted UI | every page and component under `app/` and `components/` that held copy: sign-in, overview, assistant, approvals, reports, connections, accounts, account selection, findings, audit, policies, team, agent access, billing, onboarding, OAuth consent/popup, support widget, plan-limit modal, error/loading/not-found | Only `metadata.title` (static Next metadata) stays English. |
| Formatters | `components/ui.tsx` | `formatNumber/Money/Date` take the locale; Arabic uses `ar-u-nu-latn` so metrics keep Latin digits and stay comparable with reports. |
| RTL layout | `app/globals.css` | All 32 physical direction declarations converted to logical properties (`margin-inline-*`, `padding-inline`, `inset-inline-*`, `border-inline-*`, `text-align: start/end`). Mixed-script blocks (ids, dates, report prose, chat text, code) use `unicode-bidi: plaintext` so English fragments read correctly inside Arabic pages. A `.mirror-rtl` hook flips directional icons; the nav icons are symmetric and need no mirroring. |
| Font | `@fontsource/ibm-plex-sans-arabic` (OFL-1.1), imported in `app/layout.tsx` | Self-hosted through Next (the CSP allows `font-src 'self'` only). Stack: IBM Plex Sans Arabic → Inter → system UI → Noto Sans Arabic → Tahoma. |
| Tests | `test/i18n.test.ts` | Area and key parity, no empty strings, placeholder parity, Arabic plural selection, ad terms preserved, visible fallback for missing keys. |

## 2. Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| Cloud vitest (no database) | 302 passed, 32 skipped (all upstream suites still green; two tests mock `getT()` to keep their English assertions) |
| Browser walkthrough (Playwright, standalone build) | Default `dir="rtl" lang="ar"`; IBM Plex Sans Arabic 400/500/700 loaded; all 12 dashboard sections render Arabic headings with no English sentences detected in body text; switching to English flips to `ltr/en` and back. Screenshots reviewed for overview and policies. |
| Phase 1 functional flow re-run in English | sign in → chat → proposal → Approvals → apply → audit → report PDF: OK |

## 3. Decisions and limits
- **Digits**: Latin digits in Arabic by design (media buyers compare with platform UIs and PDF reports).
- **Not translated on purpose**: brand and product names, protocol terms (OAuth, MCP, REST, API key), third-party menu paths users must match (e.g. "Settings → Apps"), the literal `DELETE` confirmation, provider-supplied dynamic text (errors, finding titles, campaign names) and engine prose.
- **Engine reports** (`engine/`) are still English and LTR: `report.html.j2` hard-codes `lang="en"` and the engine image ships only DejaVu fonts. Arabic PDF reports are listed in `docs/TODO.md` for a later phase (forked templates through `ReportRenderer(templates_dir=…)` from the engine host, no edit inside `engine/`).
- The alternate-port Supabase used for this verification exists only because this sandbox's own outbound connection happened to occupy port 55322; the project configuration is unchanged.
