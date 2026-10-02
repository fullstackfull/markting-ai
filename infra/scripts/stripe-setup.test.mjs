// node --test infra/scripts/stripe-setup.test.mjs   (no network: a fake Stripe client records calls)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envVarFor, lookupKey, mergeEnv, provision, PLAN_PRICES } from './stripe-setup.mjs';

function fakeStripe(seed = { products: [], prices: [] }) {
  const products = [...seed.products];
  const prices = [...seed.prices];
  const calls = { productCreate: 0, priceCreate: 0 };
  return {
    calls, store: { products, prices },
    products: {
      search: async ({ query }) => ({ data: products.filter((p) => query.includes(`'${p.metadata.markting_plan}'`)) }),
      create: async (input) => { calls.productCreate++; const p = { id: `prod_${products.length + 1}`, ...input }; products.push(p); return p; },
    },
    prices: {
      list: async ({ lookup_keys }) => ({ data: prices.filter((p) => lookup_keys.includes(p.lookup_key)) }),
      create: async (input) => { calls.priceCreate++; const p = { id: `price_${prices.length + 1}`, ...input }; prices.push(p); return p; },
    },
  };
}

test('creates three products and six recurring EUR prices with lookup keys and plan metadata', async () => {
  const stripe = fakeStripe();
  const env = await provision(stripe);
  assert.equal(stripe.calls.productCreate, 3);
  assert.equal(stripe.calls.priceCreate, 6);
  assert.deepEqual(Object.keys(env).sort(), [
    'STRIPE_AGENCY_ANNUAL_PRICE_ID', 'STRIPE_AGENCY_PRICE_ID', 'STRIPE_OPERATOR_ANNUAL_PRICE_ID', 'STRIPE_OPERATOR_PRICE_ID',
    'STRIPE_PREMIUM_ANNUAL_PRICE_ID', 'STRIPE_PREMIUM_PRICE_ID',
  ]);
  const annual = stripe.store.prices.find((p) => p.lookup_key === lookupKey('operator', 'annual'));
  assert.equal(annual.unit_amount, PLAN_PRICES.operator.annual);
  assert.equal(annual.currency, 'eur');
  assert.deepEqual(annual.recurring, { interval: 'year' });
  assert.equal(annual.metadata.markting_plan, 'operator');
  assert.equal(env[envVarFor('operator', 'annual')], annual.id);
  // Amounts match platform/apps/cloud/lib/cloud/plans.ts (19/190, 79/790, 149/1490 EUR).
  assert.deepEqual([PLAN_PRICES.operator.monthly, PLAN_PRICES.premium.monthly, PLAN_PRICES.agency.monthly], [1900, 7900, 14900]);
});

test('is idempotent: a second run creates nothing and returns the same ids', async () => {
  const stripe = fakeStripe();
  const first = await provision(stripe);
  const second = await provision(stripe);
  assert.deepEqual(second, first);
  assert.equal(stripe.calls.productCreate, 3);
  assert.equal(stripe.calls.priceCreate, 6);
});

test('mergeEnv replaces existing keys in place and appends missing ones', () => {
  const merged = mergeEnv('A=1\nSTRIPE_OPERATOR_PRICE_ID=old\nB=2\n', { STRIPE_OPERATOR_PRICE_ID: 'price_new', STRIPE_AGENCY_PRICE_ID: 'price_a' });
  assert.equal(merged, 'A=1\nSTRIPE_OPERATOR_PRICE_ID=price_new\nB=2\n\nSTRIPE_AGENCY_PRICE_ID=price_a');
});
