# 03 — Mobile hardening & accessibility (Programs 10–11)

Delivered in H2 (`e7d0882`), CSS appended to `app/globals.css`.

## Mobile-critical workflows
- A `.mobile-critical` responsive layer and the shell/nav adapt to phone width; the E2E mobile journey
  (E2E-08) drives the workspace at a 390×844 viewport. Charts are `width="100%"` SVGs with
  `preserveAspectRatio`, so they scale without horizontal page scroll.

## Accessibility
- `.sr-only` utility for screen-reader-only captions (used by `DataTable` in the kit).
- `:focus-visible` focus rings for keyboard navigation.
- Charts: SVG `role="img"` + `aria-label` + `<title>`/`<desc>` + a visible text summary; identity is
  never color-alone.
- Status: the design-system kit (doc 11) renders every status as a **text label + a dot**, never color
  alone, and keeps one non-overloaded status vocabulary.
- RTL: Arabic is the default locale, `html[dir="rtl"]`; the E2E RTL journey (E2E-07) asserts it.

## CI accessibility lane — honest status
A dedicated automated a11y lane (e.g. axe-core over rendered routes) was **not** added to CI in this
program; accessibility is enforced by construction (semantic markup, the kit's text-first status, the
chart summaries) and unit-tested at the component level (`kit.test.tsx` asserts labels/scoped headers/
captions). This is the one place where Gate "accessibility CI" is **PARTIAL** rather than fully
automated — called out in the exit report rather than overstated.
