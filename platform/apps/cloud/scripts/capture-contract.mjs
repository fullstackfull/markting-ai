#!/usr/bin/env node
/**
 * PHASE C.5 (item 10) — LIVE CONTRACT CAPTURE TOOLING.
 *
 * ============================= CRITICAL SAFETY CONTRACT =============================
 * OFF BY DEFAULT, READ-ONLY, BLOCKED_EXTERNAL. This CLI MUST NEVER:
 *   - run in normal CI,
 *   - write provider state (it only ever READS a response and writes a scrubbed fixture),
 *   - embed, hardcode, or print real credentials or any sensitive value,
 *   - contact a provider or write a LIVE_CAPTURED fixture unless BOTH the explicit enable flag is set AND
 *     a real provider response is actually obtained.
 * No credentials exist in this repo, so the only path that runs here is the DISABLED banner (exit 0,
 * zero network I/O, nothing written).
 * ===================================================================================
 *
 * Purpose (when enabled, in an isolated sandbox only): obtain ONE real provider response, pass it through
 * the PURE sanitizer (lib/markting/ops/sanitize.ts) so every token/secret/PII is removed, and write the
 * structurally-faithful result as a DOCUMENTATION_DERIVED-equivalent sanitized contract fixture carrying
 * honest provenance { provider, apiVersion, captureDate, sanitized: true }. A fixture is only ever labeled
 * LIVE_CAPTURED when the explicit flag is set AND a real response was captured — never otherwise.
 *
 * Invocation (no package.json script is added — that file is shared and MUST NOT be edited here):
 *     node scripts/capture-contract.mjs --provider meta --api-version v23.0
 * To ENABLE (isolated sandbox + throwaway test account ONLY):
 *     MARKTING_LIVE_CAPTURE=1 META_ACCESS_TOKEN=... node scripts/capture-contract.mjs --provider meta --api-version v23.0
 */

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

/** The exact READ-ONLY capture steps performed WHEN enabled (documented + echoed on every path). */
const CAPTURE_PLAN = [
  'Load explicitly-supplied live credentials from env (names only documented; values never printed).',
  'Issue ONE read-only request to the provider for a small sample response.',
  'Parse the response JSON (no mutation of provider state — read only).',
  'Sanitize via lib/markting/ops/sanitize.ts sanitizeProviderResponse() → removes tokens/secrets/PII, keeps shape.',
  'Assert provenance.sanitized === true (abort the write if not).',
  'Write the scrubbed body + provenance { provider, apiVersion, captureDate, sanitized:true } to a fixture file.',
  'Label provenance honestly: LIVE_CAPTURED only because a real response was obtained under the explicit flag.',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider' || a === '-p') args.provider = argv[++i];
    else if (a.startsWith('--provider=')) args.provider = a.slice('--provider='.length);
    else if (a === '--api-version' || a === '-v') args.apiVersion = argv[++i];
    else if (a.startsWith('--api-version=')) args.apiVersion = a.slice('--api-version='.length);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printPlan() {
  console.log('\nRead-only capture plan (executed only when enabled):');
  CAPTURE_PLAN.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
}

function printDisabledBanner(provider, reason) {
  const names = provider && CREDENTIAL_ENV[provider] ? CREDENTIAL_ENV[provider].join(', ') : '<PROVIDER>_ACCESS_TOKEN, ...';
  console.log('============================================================');
  console.log(' CAPTURE-CONTRACT: DISABLED / BLOCKED_EXTERNAL');
  console.log('============================================================');
  console.log(` reason: ${reason}`);
  console.log(' OFF by default, READ-ONLY. NO network call and NO fixture written on this path.');
  console.log(' A LIVE_CAPTURED fixture is NEVER written without the explicit flag AND a real response.');
  console.log(` To enable (isolated sandbox + throwaway test account ONLY):`);
  console.log(`   set MARKTING_LIVE_CAPTURE=1 and supply ${names}`);
  console.log(`   e.g. MARKTING_LIVE_CAPTURE=1 ${names.split(', ')[0]}=... \\`);
  console.log(`        node scripts/capture-contract.mjs --provider ${provider || '<provider>'} --api-version <version>`);
  printPlan();
  console.log('\nExiting 0 (safe in any environment, including CI).');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('Usage: node scripts/capture-contract.mjs --provider <id> --api-version <version> [--out <path>]');
    console.log(`Known providers: ${KNOWN_PROVIDERS.join(', ')}`);
    printPlan();
    process.exit(0);
  }

  const provider = args.provider;
  if (provider && !KNOWN_PROVIDERS.includes(provider)) {
    printDisabledBanner(undefined, `unknown provider "${provider}"`);
    process.exit(0);
  }

  // GATE 1 — explicit enable flag.
  if (process.env.MARKTING_LIVE_CAPTURE !== '1') {
    printDisabledBanner(provider, 'MARKTING_LIVE_CAPTURE is not set to 1');
    process.exit(0);
  }
  // GATE 2 — provider + api version required once enabled.
  if (!provider) {
    printDisabledBanner(undefined, '--provider <id> is required when enabled');
    process.exit(0);
  }
  if (!args.apiVersion) {
    printDisabledBanner(provider, '--api-version <version> is required when enabled');
    process.exit(0);
  }
  // GATE 3 — all credential env vars present (presence only; values never read into logs).
  const required = CREDENTIAL_ENV[provider];
  const missing = required.filter((name) => !process.env[name] || process.env[name].trim() === '');
  if (missing.length > 0) {
    printDisabledBanner(provider, `missing credentials: ${missing.join(', ')}`);
    process.exit(0);
  }

  // ---- ENABLED PATH (flag + creds present) ----
  // Still BLOCKED_EXTERNAL here: there is no wired live HTTP client in this build to obtain a REAL response,
  // and we must NEVER synthesize one and mislabel it LIVE_CAPTURED. So we stop honestly. When a real
  // transport is wired, this is where the single read + sanitize + write happens, e.g.:
  //
  //   const raw = await fetchOneSampleResponse(provider, creds);            // read-only provider call
  //   const { sanitizeProviderResponse } = await import('../lib/markting/ops/sanitize.ts'); // via a TS loader/build
  //   const { sanitized, provenance } = sanitizeProviderResponse(raw, { provider, apiVersion: args.apiVersion });
  //   if (provenance.sanitized !== true) throw new Error('refusing to write unsanitized capture');
  //   writeFileSync(out, JSON.stringify({ kind: 'LIVE_CAPTURED', provenance, body: sanitized }, null, 2));
  //
  // The sanitizer guarantees no token/secret/PII can reach the file; the fixture keeps only structural shape.
  console.log('============================================================');
  console.log(` CAPTURE-CONTRACT: ENABLED (read-only) — provider=${provider} apiVersion=${args.apiVersion}`);
  console.log('============================================================');
  console.log(' credentials: present (values intentionally not displayed)');
  printPlan();
  console.log('\nBLOCKED_EXTERNAL: no wired live HTTP client to obtain a REAL response in this build.');
  console.log('Refusing to synthesize a response or write a LIVE_CAPTURED fixture. Nothing written. Exit 0.');
  process.exit(0);
}

main();
