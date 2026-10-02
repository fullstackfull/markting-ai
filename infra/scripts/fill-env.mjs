#!/usr/bin/env node
// Fill `generate_me` placeholders in a .env file with fresh random values. Idempotent: values that
// are already set are left alone. Usage: node infra/scripts/fill-env.mjs .env
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? '.env';
const generators = {
  ADPORT_CLOUD_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  ADPORT_MCP_OAUTH_SIGNING_KEY: () => randomBytes(32).toString('base64'),
  ADPORT_API_KEY_PEPPER: () => randomBytes(32).toString('hex'),
  MARKTING_ENGINE_TOKEN: () => `mkt_${randomBytes(24).toString('base64url')}`,
  MARKTING_DEMO_PASSWORD: () => `Demo-${randomBytes(9).toString('base64url')}!1`,
};

const lines = readFileSync(file, 'utf8').split('\n');
let changed = 0;
const next = lines.map((line) => {
  const match = /^([A-Z0-9_]+)=generate_me\s*$/.exec(line);
  if (!match || !generators[match[1]]) return line;
  changed += 1;
  return `${match[1]}=${generators[match[1]]()}`;
});
writeFileSync(file, next.join('\n'));
console.log(`${file}: generated ${changed} value(s)`);
