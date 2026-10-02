#!/usr/bin/env node
// Copy the local Supabase keys from `supabase status -o env` (run in ./platform) into a .env file.
// Only the two key values change; URLs keep the host.docker.internal form the compose stack needs.
// Usage: node infra/scripts/sync-supabase-env.mjs .env
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2] ?? '.env';
const status = execFileSync('npx', ['--yes', 'supabase@latest', 'status', '-o', 'env'], {
  cwd: resolve(import.meta.dirname, '../../platform'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
const values = Object.fromEntries(status.split('\n').map((line) => /^([A-Z0-9_]+)="?([^"]*)"?$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]));
const mapping = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: values.SECRET_KEY };
for (const [key, value] of Object.entries(mapping)) if (!value) throw new Error(`supabase status did not return ${key}`);

const lines = readFileSync(file, 'utf8').split('\n');
const seen = new Set();
const next = lines.map((line) => {
  const match = /^([A-Z0-9_]+)=/.exec(line);
  if (!match || !(match[1] in mapping)) return line;
  seen.add(match[1]);
  return `${match[1]}=${mapping[match[1]]}`;
});
for (const key of Object.keys(mapping)) if (!seen.has(key)) next.push(`${key}=${mapping[key]}`);
writeFileSync(file, next.join('\n'));
console.log(`${file}: Supabase keys synced (publishable + secret)`);
