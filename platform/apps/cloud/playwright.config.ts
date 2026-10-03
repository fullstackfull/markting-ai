import { defineConfig, devices } from '@playwright/test';

/**
 * Coherence hardening Program 12 — browser E2E foundation (REAL headless Chromium, not unit-render).
 *
 * The suite in ./e2e drives the built app in headless Chromium (pre-installed at
 * PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Because `output: standalone` is set, `next start` does
 * NOT serve — we boot the copied standalone server directly (scripts/prepare-standalone.mjs must have
 * run, via `pnpm build:standalone`).
 *
 * Public journeys (landing + the unauthenticated redirect guard) run against this server with
 * PLACEHOLDER env — syntactically valid, non-secret dummy values that satisfy lib/env.ts boot
 * validation. They are NOT credentials and connect to nothing: Supabase/provider calls are never made
 * on these routes. The authenticated dashboard journeys additionally require a SEEDED Supabase auth
 * session + a DEMO-mode server; where that session is unavailable (a credential-less CI container)
 * those specs skip with an explicit reason rather than passing vacuously — see e2e/journeys.spec.ts.
 *
 * Run: `pnpm --filter @adport/cloud build:standalone && pnpm --filter @adport/cloud e2e`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const startServer = process.env.E2E_NO_SERVER !== '1';

// Non-secret placeholders so the standalone server passes lib/env.ts validation and can render public
// routes. They point at loopback / example hosts and are never used to authenticate anything.
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

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {},
  },
  // Boot the STANDALONE server (next start is incompatible with output: standalone). Skip with
  // E2E_NO_SERVER=1 (e.g. for --list, which only needs to collect specs).
  webServer: startServer
    ? {
        command: 'node .next/standalone/apps/cloud/server.js',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: true,
        env: { ...PLACEHOLDER_ENV, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
      }
    : undefined,
});
