import 'server-only';

/**
 * PHASE C (C11) — PROVIDER SCHEMA / VERSION DRIFT detection.
 *
 * Providers change their API response shapes without warning. This PURE classifier compares an observed
 * payload's field structure against the contract we expect (the fields our adapter reads + their types)
 * and reports drift, so a shape change is surfaced as an explicit, typed signal
 * (`PROVIDER_SCHEMA_CHANGED`) rather than silently corrupting a normalized row or throwing an opaque
 * parse error.
 *
 * It is deliberately conservative and read-only: it never mutates the payload, never "repairs" a shape,
 * and never upgrades a severity on its own. A breaking drift means the adapter must be reviewed before
 * the data is trusted — it does not auto-disable anything (that is the kill-switch / health layer's job).
 */

export type DriftSeverity = 'NONE' | 'ADDITIVE' | 'BREAKING';

/** A field our adapter depends on: its dotted path and the JS typeof we expect (or 'array'). */
export interface ExpectedField {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
}

/** A provider response contract: the version tag we last validated against + the fields we read. */
export interface ProviderContract {
  provider: string;
  /** The contract version/tag the adapter was written against (e.g. a provider API version). */
  version: string;
  fields: ExpectedField[];
}

export type DriftKind =
  | 'MISSING_REQUIRED_FIELD'
  | 'TYPE_CHANGED'
  | 'NEW_UNKNOWN_FIELD'
  | 'REQUIRED_FIELD_NULL';

export interface DriftFinding {
  kind: DriftKind;
  path: string;
  expected?: string;
  observed?: string;
  severity: DriftSeverity;
}

export interface SchemaDriftReport {
  provider: string;
  version: string;
  /** PROVIDER_SCHEMA_CHANGED is raised iff status !== 'NONE'. */
  status: DriftSeverity;
  signal: 'PROVIDER_SCHEMA_CHANGED' | null;
  findings: DriftFinding[];
}

function valueAt(obj: unknown, path: string): { present: boolean; value: unknown } {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return { present: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return { present: false, value: undefined };
    cur = (cur as Record<string, unknown>)[seg];
  }
  return { present: true, value: cur };
}

function observedType(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

/** Top-level keys of the payload not covered by any expected field path's first segment. */
function unknownTopLevelKeys(payload: unknown, fields: ExpectedField[]): string[] {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const known = new Set(fields.map((f) => f.path.split('.')[0]));
  return Object.keys(payload as Record<string, unknown>).filter((k) => !known.has(k));
}

/**
 * Compare one observed payload against a contract. Missing-required / type-change / required-null are
 * BREAKING; a brand-new unknown top-level field is ADDITIVE (worth noticing, not breaking). Optional
 * fields that are simply absent are NOT drift.
 */
export function detectSchemaDrift(contract: ProviderContract, payload: unknown): SchemaDriftReport {
  const findings: DriftFinding[] = [];

  for (const field of contract.fields) {
    const { present, value } = valueAt(payload, field.path);
    if (!present) {
      if (field.required) findings.push({ kind: 'MISSING_REQUIRED_FIELD', path: field.path, expected: field.type, severity: 'BREAKING' });
      continue; // optional + absent = fine
    }
    if (value === null) {
      if (field.required) findings.push({ kind: 'REQUIRED_FIELD_NULL', path: field.path, expected: field.type, observed: 'null', severity: 'BREAKING' });
      continue;
    }
    const obs = observedType(value);
    if (obs !== field.type) {
      findings.push({ kind: 'TYPE_CHANGED', path: field.path, expected: field.type, observed: obs, severity: 'BREAKING' });
    }
  }

  for (const key of unknownTopLevelKeys(payload, contract.fields)) {
    findings.push({ kind: 'NEW_UNKNOWN_FIELD', path: key, observed: 'present', severity: 'ADDITIVE' });
  }

  const status: DriftSeverity = findings.some((f) => f.severity === 'BREAKING')
    ? 'BREAKING'
    : findings.some((f) => f.severity === 'ADDITIVE')
    ? 'ADDITIVE'
    : 'NONE';

  return {
    provider: contract.provider,
    version: contract.version,
    status,
    signal: status === 'NONE' ? null : 'PROVIDER_SCHEMA_CHANGED',
    findings,
  };
}
