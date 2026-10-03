import { test, expect } from '@playwright/test';

/**
 * WAVE 27 — platform admin browser authorization. Three postures, routed to projects by tag:
 *  - @operator  → `admin` project (operator@e2e.test storage state): the plane + read surfaces load.
 *  - @owner-denied → `authed` project (buyer@e2e.test = tenant OWNER, not an operator): /admin denied.
 *  - @public    → `public` project (no session): /admin denied.
 * The guard is server-side (requirePlatformOperator → notFound), so a denied viewer never sees the
 * admin chrome. This complements the DB-level proof in platform-admin-authz.database.test.ts.
 */

test('@operator platform operator sees the admin plane and read surfaces', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('.admin-brand b')).toHaveText(/Platform Admin/i);
  await expect(page.locator('.admin-who')).toContainText(/SUPER_ADMIN/);
  await page.goto('/admin/organizations');
  await expect(page.locator('.admin-card h2').first()).toContainText(/Organizations/i);
  await page.goto('/admin/users');
  await expect(page.locator('.admin-card h2').first()).toContainText(/Users/i);
  await page.goto('/admin/security');
  await expect(page.locator('.admin-card h2').first()).toContainText(/posture/i);
});

test('@owner-denied a tenant owner cannot reach the admin plane', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('.admin-brand')).toHaveCount(0);
});

test('@public an unauthenticated visitor cannot reach the admin plane', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('.admin-brand')).toHaveCount(0);
});
