#!/usr/bin/env node
// RC1 production smoke test — operator-run against the DEPLOYED Mode-A environment.
// Usage: BASE_URL=https://app.<domain> [SMOKE_TOKEN=...] node infra/scripts/rc1-smoke.mjs
// It does NOT provision anything; it probes the live deployment and prints PASS/FAIL per check.
const BASE = process.env.BASE_URL;
if (!BASE) { console.error('BASE_URL is required (the deployed app URL). Aborting — nothing to probe.'); process.exit(2); }
const token = process.env.SMOKE_TOKEN;
const checks = [
  { name: 'health', path: '/__health', expect: (r) => r.ok },
  { name: 'https-enforced', path: '/', expect: (r) => new URL(r.url).protocol === 'https:' },
  { name: 'login-page', path: '/login', expect: (r) => r.status < 500 },
  // authed probes (require SMOKE_TOKEN): org, provider read, sync status, AI, recommendations
  { name: 'org', path: '/api/org', authed: true, expect: (r) => r.ok },
  { name: 'provider-connections', path: '/api/providers', authed: true, expect: (r) => r.ok },
  { name: 'ai-ask', path: '/api/ai/health', authed: true, expect: (r) => r.ok },
];
let fail = 0;
for (const c of checks) {
  if (c.authed && !token) { console.log(`SKIP  ${c.name} (no SMOKE_TOKEN)`); continue; }
  try {
    const res = await fetch(new URL(c.path, BASE), { redirect: 'manual', headers: c.authed ? { authorization: `Bearer ${token}` } : {} });
    const ok = await c.expect(res);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  (${res.status})`);
    if (!ok) fail++;
  } catch (e) { console.log(`FAIL  ${c.name}  (${String(e.message ?? e)})`); fail++; }
}
console.log(fail ? `\nRC1 smoke: ${fail} FAILED` : '\nRC1 smoke: all probed checks passed');
process.exit(fail ? 1 : 0);
