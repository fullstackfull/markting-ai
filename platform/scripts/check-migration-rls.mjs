import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CODE-RC Program 15 — migration RLS posture guard.
 *
 * The meaningful, non-bypassable security invariant is: EVERY table created under `public.` across the
 * supabase migrations has row-level security ENABLED (with RLS on and no permissive policy for
 * anon/authenticated, those roles get no rows regardless of table grants). The newer governance/append
 * tables additionally REVOKE from anon/authenticated as belt-and-suspenders; that stricter posture is
 * reported but not required of the original tables, which rely on RLS deny-policies.
 *
 * This is a static, dependency-free scan so a NEW public table that forgets to enable RLS fails CI in
 * the security lane rather than shipping an open table. The allowlist carries explicitly-justified
 * non-tenant exceptions.
 */
const ALLOWLIST = new Map([
  // table name → why it is exempt from the tenant RLS posture
  // (none required today; add with an explicit justification if a non-tenant public table appears)
]);

export function checkMigrationRls(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const all = files.map((f) => readFileSync(join(migrationsDir, f), 'utf8')).join('\n');

  // Tables created under public.*
  const created = new Set();
  for (const m of all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)) created.add(m[1]);

  // RLS enabled — literal `alter table public.<name> enable row level security`
  const rlsEnabled = new Set();
  for (const m of all.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)) rlsEnabled.add(m[1]);
  // Dynamic loop form: `execute format('alter table public.%I enable row level security', t)` iterating
  // over an array[...] of table names — capture those names when such a loop is present.
  const dynamicLoopTables = new Set();
  if (/%I.{0,80}enable row level security/is.test(all)) {
    for (const m of all.matchAll(/array\s*\[([^\]]+)\]/gi)) {
      for (const lit of m[1].matchAll(/'([a-z0-9_]+)'/gi)) dynamicLoopTables.add(lit[1]);
    }
  }

  // Explicit anon/authenticated revoke (belt-and-suspenders; reported, not required).
  const revoked = new Set();
  for (const m of all.matchAll(/revoke\s+[^;]*\bon\b[^;]*public\.([a-z0-9_]+)[^;]*\bfrom\b[^;]*(?:anon|authenticated)/gi)) revoked.add(m[1]);

  const missingRls = [];
  const noExplicitRevoke = [];
  for (const table of created) {
    if (ALLOWLIST.has(table)) continue;
    if (!(rlsEnabled.has(table) || dynamicLoopTables.has(table))) missingRls.push(table);
    if (!(revoked.has(table) || dynamicLoopTables.has(table))) noExplicitRevoke.push(table);
  }

  // Only a missing RLS-enable is a FAILURE; a missing explicit revoke is informational.
  return {
    ok: missingRls.length === 0,
    created: [...created].sort(),
    missingRls: missingRls.sort(),
    noExplicitRevoke: noExplicitRevoke.sort(),
  };
}

// CLI entry: scan the repo's migrations and exit non-zero on a finding.
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'supabase', 'migrations');
  const res = checkMigrationRls(dir);
  if (res.ok) {
    console.log(`migration-rls: OK — all ${res.created.length} public tables enable RLS (${res.noExplicitRevoke.length} rely on RLS deny-policy without an explicit anon/authenticated revoke)`);
    process.exit(0);
  }
  console.error(`migration-rls: FAIL — public tables missing RLS enable: ${res.missingRls.join(', ')}`);
  process.exit(1);
}
