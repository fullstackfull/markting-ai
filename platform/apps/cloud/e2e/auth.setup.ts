import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUYER_STATE } from './paths';

/**
 * CODE-RC Program 1 — produce an authenticated storage state for the seeded media-buyer by driving the
 * TEST-ONLY login route (which performs a real Supabase sign-in for a seeded user; gated by
 * MARKTING_E2E_TEST_AUTH). The resulting cookies are saved and reused by the `authed` project.
 */
setup('authenticate seeded media buyer', async ({ page }) => {
  mkdirSync(dirname(BUYER_STATE), { recursive: true });
  const res = await page.goto('/api/test/login?email=buyer@e2e.test&next=/dashboard/workspace');
  expect(res?.status(), 'test-login must be enabled (MARKTING_E2E_TEST_AUTH=1) and succeed').toBeLessThan(400);
  // The sign-in redirects to the dashboard; we should NOT be bounced back to the landing/sign-in.
  await expect(page).toHaveURL(/\/dashboard/);
  await page.context().storageState({ path: BUYER_STATE });
});
