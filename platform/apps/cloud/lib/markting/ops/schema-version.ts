/**
 * PHASE C.6 (item 6) — SCHEMA VERSIONING.
 *
 * A canonical, IN-CODE registry of the schema version coordinates for each provider integration, plus a
 * PURE compatibility check between the version we currently target and a version observed from a (future)
 * live response. This makes a version change an explicit, typed signal rather than a silent surprise, and
 * it sits ALONGSIDE the structural drift detector (lib/markting/ops/schema-drift.ts): drift inspects a
 * payload's SHAPE, this inspects its VERSION coordinates. Both are read-only and never mutate anything.
 *
 * PROVENANCE DISCIPLINE (honest, never inflated): there are NO live-captured provider responses in this
 * repo (see test/fixtures/connection-contract-provenance.ts). Every registered metadata entry is therefore
 * DOCUMENTATION_DERIVED with `lastVerifiedDate: null` — "verified" here would mean verified against a real
 * live response, which has never happened. The registry must NEVER claim 'LIVE_CAPTURED'.
 */

/** How the schema coordinates were established. Mirrors the contract-fixture provenance vocabulary. */
export type FixtureProvenance = 'LIVE_CAPTURED' | 'DOCUMENTATION_DERIVED' | 'SYNTHETIC';

/**
 * The version coordinates of one provider's data path. `apiVersion` is the provider's own API version;
 * `adapterVersion` the version of our adapter code reading it; `capabilityVersion` the version of the
 * capability/registry description; `normalizedSchemaVersion` the version of OUR canonical normalized row
 * shape the adapter emits. `lastVerifiedDate` is the ISO date these were last verified against a LIVE
 * response — null until a live capture ever happens.
 */
export interface ProviderSchemaMetadata {
  provider: string;
  apiVersion: string;
  adapterVersion: string;
  capabilityVersion: string;
  normalizedSchemaVersion: string;
  lastVerifiedDate: string | null;
  fixtureProvenance: FixtureProvenance;
}

/**
 * The compatibility verdict between a current (targeted) metadata and an observed one:
 *   COMPATIBLE  — same coordinates on every axis.
 *   MINOR_DRIFT — only the provider apiVersion differs (additive provider change; adapter review advised,
 *                 data still trustworthy pending check) — analogous to schema-drift's ADDITIVE.
 *   BREAKING    — any of OUR versions changed (adapterVersion / capabilityVersion / normalizedSchemaVersion)
 *                 — the normalized shape or capability contract moved; the path must be reviewed before the
 *                 data is trusted — analogous to schema-drift's BREAKING.
 */
export type SchemaCompatibility = 'COMPATIBLE' | 'MINOR_DRIFT' | 'BREAKING';

export interface CompatibilityResult {
  status: SchemaCompatibility;
  reasons: string[];
}

/**
 * HONEST current metadata. Only providers with a documented, audited contract are registered. meta and
 * google are DOCUMENTATION_DERIVED (shapes drawn from the published API docs — Meta Marketing API v19.0,
 * Google Ads API v17; see lib/markting/contracts/breakdown-contracts.ts) with lastVerifiedDate null: NO
 * entry is LIVE_CAPTURED because no live response has ever been recorded in this repo.
 */
const REGISTRY: Record<string, ProviderSchemaMetadata> = {
  meta: {
    provider: 'meta',
    apiVersion: 'v19.0',
    adapterVersion: '1.0.0',
    capabilityVersion: '1.0.0',
    normalizedSchemaVersion: '1.0.0',
    lastVerifiedDate: null,
    fixtureProvenance: 'DOCUMENTATION_DERIVED',
  },
  google: {
    provider: 'google',
    apiVersion: 'v17',
    adapterVersion: '1.0.0',
    capabilityVersion: '1.0.0',
    normalizedSchemaVersion: '1.0.0',
    lastVerifiedDate: null,
    fixtureProvenance: 'DOCUMENTATION_DERIVED',
  },
};

/** The current targeted metadata for a provider, or undefined if none is registered. */
export function providerSchemaMetadata(provider: string): ProviderSchemaMetadata | undefined {
  const m = REGISTRY[provider];
  return m ? { ...m } : undefined;
}

/** All registered provider schema metadata (copies — the registry is never mutated). */
export function allProviderSchemaMetadata(): ProviderSchemaMetadata[] {
  return Object.values(REGISTRY).map((m) => ({ ...m }));
}

/**
 * PURE compatibility check. A change to any of OUR versions (adapter / capability / normalized schema) is
 * BREAKING; a change to only the provider's apiVersion is MINOR_DRIFT; identical coordinates are COMPATIBLE.
 * It never mutates and never upgrades a verdict on its own — mirroring detectSchemaDrift's discipline.
 */
export function checkCompatibility(
  current: ProviderSchemaMetadata,
  observed: ProviderSchemaMetadata,
): CompatibilityResult {
  const reasons: string[] = [];
  let breaking = false;

  if (current.adapterVersion !== observed.adapterVersion) {
    reasons.push(`adapterVersion ${current.adapterVersion} -> ${observed.adapterVersion}`);
    breaking = true;
  }
  if (current.capabilityVersion !== observed.capabilityVersion) {
    reasons.push(`capabilityVersion ${current.capabilityVersion} -> ${observed.capabilityVersion}`);
    breaking = true;
  }
  if (current.normalizedSchemaVersion !== observed.normalizedSchemaVersion) {
    reasons.push(`normalizedSchemaVersion ${current.normalizedSchemaVersion} -> ${observed.normalizedSchemaVersion}`);
    breaking = true;
  }

  const minor = current.apiVersion !== observed.apiVersion;
  if (minor) reasons.push(`apiVersion ${current.apiVersion} -> ${observed.apiVersion}`);

  const status: SchemaCompatibility = breaking ? 'BREAKING' : minor ? 'MINOR_DRIFT' : 'COMPATIBLE';
  return { status, reasons };
}
