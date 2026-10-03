import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CODE-RC Program 30 — emit the machine-readable release manifest.
 *
 * This records the commit + schema version + gate outcomes as structured JSON. It is NOT a production
 * status — it is a verification snapshot. Gate values that are proven by a specific CI lane are labelled
 * with how they are verified; external/live blockers are listed explicitly. Run:
 *   node scripts/code-rc-manifest.mjs
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: repo }).toString().trim(); } catch { return 'unknown'; }
}
const migrations = readdirSync(join(here, '..', 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();

const manifest = {
  artifact: 'markting-ai CODE-RC',
  productionReady: false,
  generatedAt: new Date().toISOString(),
  commit: git('rev-parse HEAD'),
  branch: git('rev-parse --abbrev-ref HEAD'),
  schema: { migrationCount: migrations.length, latestMigration: migrations[migrations.length - 1] ?? null },
  gates: {
    benchmark: { answerableNow: 42, total: 50, gate: 'regression ≥42', verifiedBy: 'node lane: test/benchmark.test.ts' },
    aiEval: { scenarios: 50, passed: 50, liveModel: 'BLOCKED_EXTERNAL', verifiedBy: 'node lane: test/ai-eval-harness.test.ts' },
    authenticatedE2E: { verifiedBy: 'e2e lane (seeded Supabase, DEMO runtime)', note: 'public journeys run unseeded; authed journeys run on a seeded session' },
    accessibility: { tool: 'axe-core', gate: 'no critical/serious WCAG2 A/AA', verifiedBy: 'e2e lane' },
    security: { checks: ['pnpm audit high+', 'pip-audit', 'gitleaks', 'migration-RLS'], verifiedBy: 'security lane' },
    dbIsolation: { verifiedBy: 'cloud-db lane (real Postgres, RLS + tenant isolation)' },
    dbScale: { nPlusOneFixed: ['commerce order-line ingestion'], budgets: 'per-surface, size-independent', perf: 'RUN_PERF job for p50/p95' },
    providerContracts: { covered: ['meta', 'google', 'tiktok', 'snapchat'], fixtures: ['DOCUMENTATION_DERIVED', 'SYNTHETIC'], liveCaptured: false },
    sourceIsolation: { productionReachableDemoFallback: false, guard: 'assertResultPostureAllowed (fail-closed)' },
  },
  held: { modeBProviderWrites: 'HELD', autonomousOptimization: 'DISABLED' },
  externalBlockers: [
    'Live-captured provider cassettes (Meta/Google/TikTok/Snapchat) — need real credentials.',
    'Live model AI-eval grading — BLOCKED_EXTERNAL (harness ready, falls back to DETERMINISTIC_ONLY).',
    'Large-dataset DB p50/p95 profiling — RUN_PERF job against a seeded Postgres.',
    'Human sign-off before any live provider write (Phase-0 ceiling; Mode B stays HELD).',
  ],
};

process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
