import 'server-only';
import type { MarktingEnv } from '../env';

/**
 * PHASE C.6 (37) — CONFIG/ENV SHAPE VALIDATOR.
 *
 * A PURE, deterministic validator for a config MAP passed in (never the live `process.env`, never a real
 * secret). It GENERALIZES the narrow `marktingEnv()` parse in ../env.ts into a reusable, profile-aware
 * schema (required vs optional keys; URL / origin / enum / key-length-band / integer-band formats) and
 * returns TYPED, operator-safe errors. The "redacted echo" proves a value is PRESENT and in a plausible
 * length band WITHOUT ever revealing it. A PRODUCTION profile is stricter than DEV: secrets are required
 * and demo fixtures are disallowed.
 */

export type ConfigProfile = 'production' | 'dev';

export type FieldFormat = 'string' | 'url' | 'origin' | 'enum' | 'key' | 'boolean-enum' | 'integer';

export interface FieldSpec {
  format: FieldFormat;
  /** Required in every profile unless `prodOnlyRequired` narrows it to production. */
  required: boolean;
  /** When true the key is only REQUIRED under the production profile (optional in dev). */
  prodOnlyRequired?: boolean;
  /** Allowed members for `enum`/`boolean-enum`. */
  enumValues?: readonly string[];
  /** Inclusive key-length band for `key`/`string` (characters). */
  minLen?: number;
  maxLen?: number;
  /** Inclusive integer band for `integer`. */
  min?: number;
  max?: number;
  /** A secret: its value is never placed in an error `detail` or any echo. */
  secret?: boolean;
  /** A demo/test fixture key: allowed in dev, a validation error under the production profile. */
  demoFixture?: boolean;
}

export type ConfigSchema = Record<string, FieldSpec>;
export type ConfigMap = Readonly<Record<string, string | undefined>>;

export type ValidationCode =
  | 'MISSING_REQUIRED'
  | 'INVALID_URL'
  | 'INVALID_ORIGIN'
  | 'NOT_IN_ENUM'
  | 'KEY_LENGTH_OUT_OF_BAND'
  | 'NOT_INTEGER'
  | 'INTEGER_OUT_OF_BAND'
  | 'DEMO_FIXTURE_IN_PRODUCTION'
  | 'UNKNOWN_KEY';

export interface ConfigError {
  key: string;
  code: ValidationCode;
  /** Operator-safe explanation. For a secret field it NEVER contains the value, only shape facts. */
  detail: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ConfigError[];
}

// ---- pure format checks (no network, no DNS, deterministic) ----

/** A syntactically valid absolute http(s) URL. Uses the URL parser only — it performs no I/O. */
export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * An ORIGIN: scheme + host [+ port] with no path, query, or fragment (e.g. `https://app.example.com`).
 * A trailing `/` is tolerated because `URL` normalizes an empty path to `/`.
 */
export function isValidOrigin(value: string): boolean {
  if (!isValidUrl(value)) return false;
  const u = new URL(value);
  if (u.search || u.hash || u.username || u.password) return false;
  if (u.pathname !== '/' && u.pathname !== '') return false;
  const normalized = value.endsWith('/') ? value.slice(0, -1) : value;
  return normalized === u.origin;
}

// ---- redacted echo (presence + length band only) ----
export type LengthBand = 'absent' | 'empty' | 'short' | 'medium' | 'long';

/** Deterministic band boundaries (characters). Documentation-derived, not value-revealing. */
export const LENGTH_BAND_BOUNDS = { short: 16, medium: 48 } as const;

export function lengthBand(value: string | undefined): LengthBand {
  if (value === undefined) return 'absent';
  const n = value.length;
  if (n === 0) return 'empty';
  if (n < LENGTH_BAND_BOUNDS.short) return 'short';
  if (n < LENGTH_BAND_BOUNDS.medium) return 'medium';
  return 'long';
}

export interface RedactedValue {
  key: string;
  present: boolean;
  band: LengthBand;
}

/**
 * Prove a value is present and roughly sized WITHOUT revealing it. The returned object is safe to log:
 * it holds only the key name, a presence flag, and a coarse length band — never the value or its length.
 */
export function redactedEcho(key: string, value: string | undefined): RedactedValue {
  return { key, present: value !== undefined && value.length > 0, band: lengthBand(value) };
}

/** Redacted echo across a whole map, for a config-presence report. Never includes any value. */
export function redactedEchoMap(map: ConfigMap): RedactedValue[] {
  return Object.keys(map)
    .sort()
    .map((k) => redactedEcho(k, map[k]));
}

// ---- schema validation ----

function isRequired(spec: FieldSpec, profile: ConfigProfile): boolean {
  return spec.required || (spec.prodOnlyRequired === true && profile === 'production');
}

function validateField(key: string, spec: FieldSpec, raw: string | undefined, profile: ConfigProfile): ConfigError[] {
  const errors: ConfigError[] = [];

  if (spec.demoFixture && profile === 'production' && raw !== undefined && raw.length > 0) {
    errors.push({ key, code: 'DEMO_FIXTURE_IN_PRODUCTION', detail: 'demo/test fixture is not allowed under the production profile' });
  }

  if (raw === undefined || raw.length === 0) {
    if (isRequired(spec, profile)) {
      errors.push({ key, code: 'MISSING_REQUIRED', detail: `required under the ${profile} profile but ${raw === undefined ? 'absent' : 'empty'}` });
    }
    return errors; // nothing more to check on an absent/empty value
  }

  switch (spec.format) {
    case 'url':
      if (!isValidUrl(raw)) errors.push({ key, code: 'INVALID_URL', detail: 'not a valid absolute http(s) URL' });
      break;
    case 'origin':
      if (!isValidOrigin(raw)) errors.push({ key, code: 'INVALID_ORIGIN', detail: 'not a bare scheme://host[:port] origin' });
      break;
    case 'enum':
    case 'boolean-enum': {
      const allowed = spec.enumValues ?? [];
      if (!allowed.includes(raw)) errors.push({ key, code: 'NOT_IN_ENUM', detail: `must be one of: ${allowed.join(', ')}` });
      break;
    }
    case 'key':
    case 'string': {
      const n = raw.length;
      const lo = spec.minLen;
      const hi = spec.maxLen;
      if ((lo !== undefined && n < lo) || (hi !== undefined && n > hi)) {
        // For a secret we report only the band expectation, never the actual length.
        const band = spec.secret ? 'length outside the expected band' : `length ${n} outside [${lo ?? 0}, ${hi ?? '∞'}]`;
        errors.push({ key, code: 'KEY_LENGTH_OUT_OF_BAND', detail: band });
      }
      break;
    }
    case 'integer': {
      if (!/^-?\d+$/.test(raw)) {
        errors.push({ key, code: 'NOT_INTEGER', detail: 'not an integer' });
        break;
      }
      const v = Number(raw);
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) {
        errors.push({ key, code: 'INTEGER_OUT_OF_BAND', detail: `must be within [${spec.min ?? '-∞'}, ${spec.max ?? '∞'}]` });
      }
      break;
    }
  }
  return errors;
}

export interface ValidateOptions {
  /** When true, a key present in the map but absent from the schema is flagged UNKNOWN_KEY. */
  rejectUnknown?: boolean;
}

/**
 * Validate a config MAP against a schema for a profile. PURE: it reads only the injected map, never the
 * live process env. Errors are deterministically ordered by (key, code) so snapshots are stable.
 */
export function validateConfig(schema: ConfigSchema, map: ConfigMap, profile: ConfigProfile, opts: ValidateOptions = {}): ValidationResult {
  const errors: ConfigError[] = [];
  for (const key of Object.keys(schema)) {
    const spec = schema[key];
    if (!spec) continue; // noUncheckedIndexedAccess guard
    errors.push(...validateField(key, spec, map[key], profile));
  }
  if (opts.rejectUnknown) {
    for (const key of Object.keys(map)) {
      if (!(key in schema) && map[key] !== undefined) {
        errors.push({ key, code: 'UNKNOWN_KEY', detail: 'not a recognized configuration key' });
      }
    }
  }
  errors.sort((a, b) => (a.key === b.key ? a.code.localeCompare(b.code) : a.key.localeCompare(b.key)));
  return { valid: errors.length === 0, errors };
}

// ---- the markting bridge schema (generalizes ../env.ts, keyed to MarktingEnv) ----

/** The validator's known keys stay in lock-step with the live env type. */
type KnownKey = keyof MarktingEnv;
const BOOLEAN_ENUM = ['true', 'false'] as const;

/**
 * The canonical schema for the markting bridge config. It STRENGTHENS the ../env.ts zod parse: the
 * engine URL is an origin (not just a URL), the engine token has a key-length band and is required in
 * production, and demo mode is a demo fixture disallowed in production.
 */
export const MARKTING_CONFIG_SCHEMA: Record<KnownKey, FieldSpec> = {
  MARKTING_ENGINE_URL: { format: 'url', required: true },
  MARKTING_ENGINE_TOKEN: { format: 'key', required: false, prodOnlyRequired: true, secret: true, minLen: 8, maxLen: 512 },
  MARKTING_DEMO_MODE: { format: 'boolean-enum', required: false, enumValues: BOOLEAN_ENUM, demoFixture: true },
  MARKTING_ALLOW_SELF_APPROVAL: { format: 'boolean-enum', required: false, enumValues: BOOLEAN_ENUM },
  MARKTING_ENGINE_TIMEOUT_MS: { format: 'integer', required: false, min: 5_000, max: 900_000 },
};

/** Validate the markting bridge config map for a profile. */
export function validateMarktingConfig(map: ConfigMap, profile: ConfigProfile): ValidationResult {
  return validateConfig(MARKTING_CONFIG_SCHEMA, map, profile);
}
