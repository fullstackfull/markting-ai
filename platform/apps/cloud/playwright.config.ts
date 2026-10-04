import { defineConfig, devices } from '@playwright/test';
import { BUYER_STATE, OPERATOR_STATE } from './e2e/paths';

/**
 * CODE-RC browser E2E — real headless Chromium (pre-installed at PLAYWRIGHT_BROWSERS_PATH).
 *
 * Two postures, selected by E2E_SEEDED_SESSION:
 *  - UNSEEDED (default): only the `public` project runs — landing + the unauthenticated redirect guard —
 *    against the standalone server booted with non-secret PLACEHOLDER env. No DB/Supabase needed.
 *  - SEEDED (E2E_SEEDED_SESSION=1, set by the CI e2e lane): the `setup` project authenticates a seeded
 *    user via the test-only login route, then the `authed` project runs the full media-buyer journeys
 *    with that storage state. The lane boots Supabase, seeds tenants, and runs the server in DEMO
 *    runtime with the REAL Supabase env (so auth resolves and surfaces have synthetic content), passing
 *    that env through to the webServer below (not the placeholders).
 *
 * Because `output: standalone` is set, the server is the copied standalone server (run
 * `pnpm build:standalone` first), never `next start`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const SEEDED = process.env.E2E_SEEDED_SESSION === '1';
const startServer = process.env.E2E_NO_SERVER !== '1';

// Non-secret placeholders so the standalone server passes lib/env.ts validation for PUBLIC routes.
const PLACEHOLDER_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'e2e_placeholder_publishable_key_0000000',
  SUPABASE_SECRET_KEY: 'e2e_placeholder_secret_key_000000000000',
  SUPABASE_DB_URL: 'postgresql://e2e:e2e@127.0.0.1:5432/e2e',
  ADPORT_CLOUD_BASE_URL: 'http://127.0.0.1:3100',
  ADPORT_CLOUD_ENCRYPTION_KEY: 'e2e_placeholder_encryption_key_00000000000000000000',
  ADPORT_API_KEY_PEPPER: 'e2e_placeholder_api_key_pepper_000000000',
  ADPORT_MCP_OAUTH_SIGNING_KEY: 'e2e_placeholder_mcp_oauth_signing_key_00000000000000',
};

// In the SEEDED lane, the server must use the REAL Supabase env (inherited from the lane) plus DEMO
// runtime and the test-auth flag; passing undefined values lets the child inherit the real ones.
const SEEDED_SERVER_ENV: Record<string, string> = {
  MARKTING_RUNTIME_MODE: 'DEMO',
  MARKTING_DEMO_MODE: 'true',
  MARKTING_E2E_TEST_AUTH: '1',
  PORT: String(PORT),
  HOSTNAME: '127.0.0.1',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {},
  },
  projects: SEEDED
    ? [
        { name: 'setup', testMatch: /e2e\/auth\.setup\.ts$/ },
        { name: 'admin-setup', testMatch: /e2e\/admin-auth\.setup\.ts$/ },
        { name: 'public', testMatch: /(journeys|a11y|admin)\.spec\.ts/, grep: /@public/ },
        // authed = seeded media buyer (tenant OWNER, not a platform operator): journeys/a11y + the
        // @owner-denied admin check. Excludes @public and @operator.
        { name: 'authed', testMatch: /(journeys|a11y|admin)\.spec\.ts/, grepInvert: /@public|@operator/, dependencies: ['setup'], use: { storageState: BUYER_STATE } },
        // admin = seeded SUPER_ADMIN operator: only the @operator admin checks.
        { name: 'admin', testMatch: /admin\.spec\.ts/, grep: /@operator/, dependencies: ['admin-setup'], use: { storageState: OPERATOR_STATE } },
      ]
    : [{ name: 'public', testMatch: /(journeys|a11y|admin)\.spec\.ts/, grep: /@public/ }],
  webServer: startServer
    ? {
        command: 'node .next/standalone/apps/cloud/server.js',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: true,
        env: SEEDED ? { ...SEEDED_SERVER_ENV, PORT: String(PORT), HOSTNAME: '127.0.0.1' } : { ...PLACEHOLDER_ENV, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
      }
    : undefined,
});
