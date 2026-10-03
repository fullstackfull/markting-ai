import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkMigrationRls } from './check-migration-rls.mjs';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

test('every public table in the migrations enables row-level security', () => {
  const res = checkMigrationRls(migrationsDir);
  assert.equal(res.ok, true, `public tables missing RLS enable: ${res.missingRls.join(', ')}`);
  assert.ok(res.created.length > 0, 'expected to find created public tables');
});

test('the checker actually fails when a table forgets RLS (self-test on a synthetic dir)', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'rls-'));
  writeFileSync(join(dir, '001.sql'), 'create table public.open_table (id uuid primary key);');
  const res = checkMigrationRls(dir);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missingRls, ['open_table']);
});
