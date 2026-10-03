import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * CODE-RC Program 13/14 — automated accessibility (axe-core) over real rendered pages.
 *
 * The gate is: NO `critical` or `serious` WCAG 2.1 A/AA violations. Moderate/minor findings are
 * reported but not blocking (and any rule we deliberately exclude is named here with a reason — we do
 * NOT disable rules merely to turn CI green). `@public` scans run unseeded (landing). The dashboard
 * scans run in the `authed` project (seeded media-buyer, DEMO runtime) and cover English + Arabic/RTL.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
// Deliberately excluded rules (named + justified), none of which hides a real barrier:
//   (none today) — add here with a one-line reason if ever required.
const EXCLUDED_RULES: string[] = [];

async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).disableRules(EXCLUDED_RULES).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  // Rich, element-level descriptions so a CI failure names the exact node + colors to fix, rather than
  // just the rule id (otherwise contrast findings are undebuggable without the trace).
  const describe = blocking.flatMap((v) =>
    v.nodes.map((n) => `${v.id} [${v.impact}] ${n.target.join(' ')} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').trim()}`),
  );
  return { blocking, describe, all: results.violations };
}

test('A11Y-00 @public landing has no critical/serious axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  const { describe } = await scan(page);
  expect(describe).toEqual([]);
});

const DASHBOARD = ['/dashboard/workspace', '/dashboard/commerce', '/dashboard/creative', '/dashboard/agency', '/dashboard/executive', '/dashboard/assistant', '/dashboard/recommendations', '/dashboard/data-quality', '/dashboard/governance'];

for (const route of DASHBOARD) {
  test(`A11Y ${route} (en) has no critical/serious axe violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const { describe } = await scan(page);
    expect(describe).toEqual([]);
  });
}

test('A11Y workspace (ar / RTL) has no critical/serious axe violations', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL ?? 'http://localhost:3100' }]);
  await page.goto('/dashboard/workspace');
  await expect(page.locator('html[dir="rtl"]')).toBeAttached();
  const { describe } = await scan(page);
  expect(describe).toEqual([]);
});
