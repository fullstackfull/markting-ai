/**
 * CONNECTIONS CONTROL PLANE — provider contract-fixture PROVENANCE manifest.
 *
 * Every provider with an adapter is listed with the provenance of the fixtures that exercise it, and the
 * test that uses them. Provenance is classified honestly and NEVER mislabelled:
 *   LIVE_CAPTURED        — recorded from a real authenticated provider response
 *   DOCUMENTATION_DERIVED — constructed from the provider's published API docs (official envelope shapes)
 *   SYNTHETIC            — hand-authored shapes/ids with no live capture
 *
 * Grounded in the discovery audit: there are currently NO live-captured provider cassettes in this repo;
 * every provider HTTP fixture is synthetic or documentation-derived. This manifest records that truth so
 * a reviewer can see exactly what is and is not backed by live evidence.
 */
export type FixtureProvenance = 'LIVE_CAPTURED' | 'DOCUMENTATION_DERIVED' | 'SYNTHETIC';

export interface ContractFixtureRecord {
  provider: string;
  provenance: FixtureProvenance;
  test: string;
  note: string;
}

export const CONNECTION_CONTRACT_FIXTURES: ContractFixtureRecord[] = [
  { provider: 'google', provenance: 'DOCUMENTATION_DERIVED', test: 'test/google-oauth.test.ts + provider-oauth.test.ts', note: 'GAQL/authorize/token shapes from Google Ads API docs; no live capture.' },
  { provider: 'meta', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-oauth.test.ts', note: 'Graph API envelope shapes from docs; debug_token shape documented.' },
  { provider: 'tiktok', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-oauth.test.ts', note: 'Business API v1.3 envelope shapes from docs.' },
  { provider: 'microsoft', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-oauth.test.ts', note: 'Bing Ads v13 + token shapes from docs; sandbox dev token.' },
  { provider: 'reddit', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-expansion-oauth.test.ts + provider-expansion-runtime.test.ts', note: 'Ads API v3 + OAuth endpoints from docs.' },
  { provider: 'apple', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-oauth.test.ts', note: 'Apple Search Ads v1 + ES256 client-secret shapes from docs; test key generated locally.' },
  { provider: 'snapchat', provenance: 'DOCUMENTATION_DERIVED', test: 'test/markting-snapchat-wire.test.ts + provider-expansion-oauth.test.ts', note: 'Official envelope shapes, synthetic ids; nothing contacts Snapchat.' },
  { provider: 'spotify', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-expansion-oauth.test.ts', note: 'Partner Ads v3 endpoints from docs.' },
  { provider: 'pinterest', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-expansion-oauth.test.ts', note: 'Pinterest v5 endpoints from docs.' },
  { provider: 'linkedin', provenance: 'DOCUMENTATION_DERIVED', test: 'test/provider-expansion-oauth.test.ts', note: 'Rest.li 2.0 endpoints from docs.' },
  { provider: 'x', provenance: 'DOCUMENTATION_DERIVED', test: 'test/x-oauth-routes.test.ts', note: 'Ads API v12 + OAuth 1.0a three-legged shapes from docs.' },
  { provider: 'salla', provenance: 'SYNTHETIC', test: 'test/phase5-commerce.test.ts', note: 'Synthetic order/product/refund payloads via injectable RawSource; live transport BLOCKED_EXTERNAL.' },
  { provider: 'zid', provenance: 'SYNTHETIC', test: 'test/phase5-commerce.test.ts', note: 'Synthetic payloads; live transport BLOCKED_EXTERNAL.' },
  { provider: 'shopify', provenance: 'SYNTHETIC', test: 'test/phase5-commerce.test.ts', note: 'Synthetic payloads incl. InventoryItem cost; live transport BLOCKED_EXTERNAL.' },
  { provider: 'woocommerce', provenance: 'SYNTHETIC', test: 'test/phase5-commerce.test.ts', note: 'Synthetic payloads incl. negative-line refunds; live transport BLOCKED_EXTERNAL.' },
  { provider: 'custom', provenance: 'SYNTHETIC', test: 'test/phase5-commerce.test.ts', note: 'Generic connector synthetic payloads; live transport BLOCKED_EXTERNAL.' },
];
