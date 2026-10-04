#!/usr/bin/env node
/**
 * PHASE C.5 (item 9) — LIVE-VERIFICATION HARNESS.
 *
 * ============================= CRITICAL SAFETY CONTRACT =============================
 * This harness is OFF BY DEFAULT and READ-ONLY. It MUST NEVER:
 *   - run in normal CI,
 *   - write any provider state (no Mode B, no budget/pause/resume, no mutations of any kind),
 *   - embed, hardcode, or print real credentials,
 *   - contact a provider unless BOTH the explicit enable flag is set AND credentials are supplied.
 * By repo posture it is BLOCKED_EXTERNAL: no real credentials exist here, so the only path that ever
 * executes in this environment is the DISABLED banner below, which performs zero network I/O and exits 0
 * (so invoking it in any environment — including CI — is safe).
 * ===================================================================================
 *
 * Invocation (NOTE: no `live:verify` script is added to package.json — that file is shared and MUST NOT be
 * edited here; run the harness directly):
 *     node scripts/live-verify.mjs --provider meta
 * The documented-but-not-wired npm alias would be `pnpm live:verify -- --provider meta`.
 *
 * To ENABLE (only ever in a disposable, isolated, hand-run sandbox against a throwaway test account):
 *     MARKTING_LIVE_VERIFY=1 META_ACCESS_TOKEN=... META_AD_ACCOUNT_ID=... node scripts/live-verify.mjs --provider meta
 * Credential VALUES are never written here — only the env var NAMES are documented.
 */

// ---------------------------------------------------------------------------------------------------
// Credential env var NAMES per provider (names only — values are supplied at runtime by the operator and
// are NEVER hardcoded, logged, or echoed). Grounded in lib/connections/registry.ts provider ids.
// ---------------------------------------------------------------------------------------------------
const CREDENTIAL_ENV = {
  meta: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'],
  google: ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_DEVELOPER_TOKEN', 'GOOGLE_CUSTOMER_ID'],
  tiktok: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'],
  microsoft: ['MICROSOFT_ACCESS_TOKEN', 'MICROSOFT_DEVELOPER_TOKEN', 'MICROSOFT_CUSTOMER_ID'],
  reddit: ['REDDIT_ACCESS_TOKEN', 'REDDIT_AD_ACCOUNT_ID'],
  apple: ['APPLE_ACCESS_TOKEN', 'APPLE_ORG_ID'],
  snapchat: ['SNAPCHAT_ACCESS_TOKEN', 'SNAPCHAT_AD_ACCOUNT_ID'],
  spotify: ['SPOTIFY_ACCESS_TOKEN', 'SPOTIFY_AD_ACCOUNT_ID'],
  pinterest: ['PINTEREST_ACCESS_TOKEN', 'PINTEREST_AD_ACCOUNT_ID'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID'],
  x: ['X_ACCESS_TOKEN', 'X_AD_ACCOUNT_ID'],
};

const KNOWN_PROVIDERS = Object.keys(CREDENTIAL_ENV);

// Hard safety caps for the (enabled) read path.
const MAX_ROWS = 25; // bounded dataset — never fetch more than this many rows
const READ_ONLY = true; // this harness NEVER flips to a write mode

/**
 * The exact READ-ONLY verification steps the harness performs WHEN enabled. Documented here and echoed to
 * the console so the plan is auditable even on the disabled path.
 */
const VERIFICATION_PLAN = [
  'Load explicitly-supplied live credentials from env (names only are documented; values never printed).',
  'Identify the designated throwaway TEST org/account (never a production tenant).',
  'Verify auth against the provider (read-only identity/token-debug call).',
  'Discover ad accounts (read-only account enumeration).',
  `Fetch a SMALL bounded dataset — hard cap ${MAX_ROWS} rows (read-only report pull).`,
  'Normalize raw rows → canonical ReportRow via the live read path (lib/cloud/live-gatherer).',
  'Validate rows (validateReportRow): classify/reject, never silently coerce.',
  'Persist/read canonical observations as PLATFORM_REPORTED trust (read-model round-trip).',
  'Run the deterministic diagnosis engine (analyzeAccount) over the normalized observations.',
  'Verify read-model / UI compatibility of the resulting slices (shape only).',
  'Redact all secrets/PII from any captured sample (lib/markting/ops/sanitize).',
  'Write a verification report (docs/phase-c/live-verification-report.md style) to a gitignored/tmp path or stdout.',
];

function parseArgs(argv) {
  const args = { provider: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider' || a === '-p') args.provider = argv[++i];
    else if (a.startsWith('--provider=')) args.provider = a.slice('--provider='.length);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printPlan() {
  console.log('\nRead-only verification plan (executed only when enabled):');
  VERIFICATION_PLAN.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
}

function printDisabledBanner(provider, reason) {
  const names = provider && CREDENTIAL_ENV[provider] ? CREDENTIAL_ENV[provider].join(', ') : '<PROVIDER>_ACCESS_TOKEN, ...';
  console.log('============================================================');
  console.log(' LIVE-VERIFY: DISABLED / BLOCKED_EXTERNAL');
  console.log('============================================================');
  console.log(` reason: ${reason}`);
  console.log(' This harness is OFF by default, READ-ONLY, and makes NO network calls on this path.');
  console.log(` To enable (isolated sandbox + throwaway test account ONLY):`);
  console.log(`   set MARKTING_LIVE_VERIFY=1 and supply ${names}`);
  console.log(`   e.g. MARKTING_LIVE_VERIFY=1 ${names.split(', ').map((n) => `${n}=...`).join(' ')} \\`);
  console.log(`        node scripts/live-verify.mjs --provider ${provider || '<provider>'}`);
  printPlan();
  console.log('\nNo provider was contacted. Exiting 0 (safe in any environment, including CI).');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('Usage: node scripts/live-verify.mjs --provider <id>');
    console.log(`Known providers: ${KNOWN_PROVIDERS.join(', ')}`);
    printPlan();
    process.exit(0);
  }

  const provider = args.provider;
  if (provider && !KNOWN_PROVIDERS.includes(provider)) {
    console.log(`live-verify: unknown provider "${provider}". Known: ${KNOWN_PROVIDERS.join(', ')}`);
    printDisabledBanner(undefined, 'unknown provider');
    process.exit(0);
  }

  // GATE 1 — explicit enable flag. Absent => disabled banner, exit 0, no network.
  if (process.env.MARKTING_LIVE_VERIFY !== '1') {
    printDisabledBanner(provider, 'MARKTING_LIVE_VERIFY is not set to 1');
    process.exit(0);
  }

  // GATE 2 — provider required once enabled.
  if (!provider) {
    printDisabledBanner(undefined, '--provider <id> is required when enabled');
    process.exit(0);
  }

  // GATE 3 — all credential env vars must be explicitly supplied (values checked for presence only,
  // never read into logs). Any missing => disabled/blocked banner, exit 0, no network.
  const required = CREDENTIAL_ENV[provider];
  const missing = required.filter((name) => !process.env[name] || process.env[name].trim() === '');
  if (missing.length > 0) {
    printDisabledBanner(provider, `missing credentials: ${missing.join(', ')}`);
    process.exit(0);
  }

  // ---- ENABLED PATH (flag + all creds present) ----
  // Even here the harness stays strictly READ-ONLY and refuses to fabricate network I/O. In this repo the
  // standalone live transport is NOT wired (BLOCKED_EXTERNAL — the live read path runs inside the app
  // server runtime with a tenant principal + DB, not from a bare script), so rather than invent calls we
  // stop honestly after echoing the plan. This keeps the harness truthful and incapable of silent writes.
  console.log('============================================================');
  console.log(` LIVE-VERIFY: ENABLED (read-only) — provider=${provider}`);
  console.log('============================================================');
  console.log(` mode: READ_ONLY=${READ_ONLY}  (no writes, no Mode B, hard row cap=${MAX_ROWS})`);
  console.log(' credentials: present (values intentionally not displayed)');
  printPlan();
  console.log('\nBLOCKED_EXTERNAL: standalone live transport is not wired in this build.');
  console.log('Run the live read path inside the app server runtime (lib/cloud/live-gatherer) with a');
  console.log('tenant principal; this harness refuses to fabricate provider calls. No network I/O performed.');
  // Exit 0: enabled but intentionally a no-op here — still safe, still read-only, nothing written.
  process.exit(0);
}

main();
