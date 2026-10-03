import { resolve } from 'node:path';
import { config } from 'dotenv';
import { configDefaults, defineConfig } from 'vitest/config';

config({ path: resolve(import.meta.dirname, '.env.local'), quiet: true });

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': import.meta.dirname,
      'server-only': resolve(import.meta.dirname, 'test/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    // The Playwright browser suite in ./e2e uses @playwright/test's runner, not vitest — exclude it so
    // vitest does not try to execute *.spec.ts browser journeys (they run via `pnpm e2e`).
    exclude: [...configDefaults.exclude, '.next/**', 'e2e/**'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    sequence: { concurrent: false },
  },
});
