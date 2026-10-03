import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { OPERATOR_STATE } from './paths';

/**
 * WAVE 27 — authenticated storage state for the seeded PLATFORM OPERATOR (operator@e2e.test, a
 * SUPER_ADMIN on the platform_operators roster). Drives the same test-only login route, then navigates
 * to /admin to confirm the guard admits an operator, and saves the session for the `admin` project.
 */
setup('authenticate platform operator', async ({ page }) => {
  mkdirSync(dirname(OPERATOR_STATE), { recursive: true });
  const res = await page.goto('/api/test/login?email=operator@e2e.test&next=/admin');
  expect(res?.status(), 'test-login must be enabled and succeed for the operator').toBeLessThan(400);
  await expect(page).toHaveURL(/\/admin/);
  await page.context().storageState({ path: OPERATOR_STATE });
});
