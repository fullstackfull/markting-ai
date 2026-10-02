#!/usr/bin/env node
// Provision the Stripe products and prices that adport's billing expects, idempotently, and print
// (or write) the STRIPE_*_PRICE_ID variables. Safe to re-run: prices are found by `lookup_key`.
//
//   STRIPE_SECRET_KEY=sk_test_... node infra/scripts/stripe-setup.mjs            # print env lines
//   STRIPE_SECRET_KEY=sk_test_... node infra/scripts/stripe-setup.mjs --write .env  # also update .env
//
// Amounts mirror platform/apps/cloud/lib/cloud/plans.ts (EUR, tax-exclusive). Change them there
// first if you change pricing; this script never edits plans.ts.
import { readFileSync, writeFileSync } from 'node:fs';

export const PLAN_PRICES = {
  operator: { name: 'Adport Operator', monthly: 1900, annual: 19000 },
  premium: { name: 'Adport Premium', monthly: 7900, annual: 79000 },
  agency: { name: 'Adport Agency', monthly: 14900, annual: 149000 },
};
export const CURRENCY = 'eur';

export function envVarFor(plan, interval) {
  return `STRIPE_${plan.toUpperCase()}_${interval === 'annual' ? 'ANNUAL_' : ''}PRICE_ID`;
}

export function lookupKey(plan, interval) {
  return `markting_${plan}_${interval}`;
}

/** Create-or-find products and prices. `stripe` is any client exposing products.{search,create} and prices.{list,create}. */
export async function provision(stripe, log = () => {}) {
  const result = {};
  for (const [plan, spec] of Object.entries(PLAN_PRICES)) {
    const found = await stripe.products.search({ query: `metadata['markting_plan']:'${plan}'`, limit: 1 });
    let product = found.data[0];
    if (!product) {
      product = await stripe.products.create({ name: spec.name, metadata: { markting_plan: plan } });
      log(`created product ${product.id} (${spec.name})`);
    } else {
      log(`product ${product.id} (${spec.name}) exists`);
    }
    for (const interval of ['monthly', 'annual']) {
      const key = lookupKey(plan, interval);
      const existing = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
      let price = existing.data[0];
      if (!price) {
        price = await stripe.prices.create({
          product: product.id,
          currency: CURRENCY,
          unit_amount: spec[interval],
          recurring: { interval: interval === 'annual' ? 'year' : 'month' },
          lookup_key: key,
          metadata: { markting_plan: plan, markting_interval: interval },
        });
        log(`created price ${price.id} ${key} ${spec[interval] / 100} ${CURRENCY}/${interval}`);
      } else {
        log(`price ${price.id} ${key} exists`);
      }
      result[envVarFor(plan, interval)] = price.id;
    }
  }
  return result;
}

/** Replace or append `KEY=value` lines; other lines are untouched. */
export function mergeEnv(contents, values) {
  const lines = contents.split('\n');
  const seen = new Set();
  const next = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match || !(match[1] in values)) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });
  for (const [key, value] of Object.entries(values)) if (!seen.has(key)) next.push(`${key}=${value}`);
  return next.join('\n');
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_(test|live)_/.test(key)) throw new Error('Set STRIPE_SECRET_KEY (sk_test_... recommended) in the environment.');
  if (key.startsWith('sk_live_') && !process.argv.includes('--live')) throw new Error('Refusing a live key without --live.');
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(key);
  const values = await provision(stripe, (line) => console.error(line));
  const writeIndex = process.argv.indexOf('--write');
  if (writeIndex !== -1) {
    const file = process.argv[writeIndex + 1] ?? '.env';
    writeFileSync(file, mergeEnv(readFileSync(file, 'utf8'), values));
    console.error(`${file}: wrote ${Object.keys(values).length} price ids`);
  }
  for (const [name, value] of Object.entries(values)) console.log(`${name}=${value}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
