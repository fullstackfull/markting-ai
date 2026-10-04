import { describe, expect, it } from 'vitest';
import {
  evaluateDeploymentReadiness, readinessGate, blockingChecks,
  REQUIRED_SECURITY_HEADERS, SECURE_COOKIE_FLAGS, PRODUCTION_SAFE_RUNTIME_MODES, EXPECTED_SAFE_DEPLOYMENT,
  type DeploymentFacts, type SecurityHeader,
} from '@/lib/markting/ops/deployment-hardening';
import {
  validateConfig, validateMarktingConfig, redactedEcho, redactedEchoMap, lengthBand,
  isValidUrl, isValidOrigin, MARKTING_CONFIG_SCHEMA, LENGTH_BAND_BOUNDS,
  type ConfigSchema, type ConfigMap,
} from '@/lib/markting/ops/config-validation';

// ---- a fully-satisfied production fact set (every CRITICAL fact safe) ----
const allHeaders = (): Record<SecurityHeader, boolean> =>
  Object.fromEntries(REQUIRED_SECURITY_HEADERS.map((h) => [h, true])) as Record<SecurityHeader, boolean>;

const readyFacts = (o: Partial<DeploymentFacts> = {}): DeploymentFacts => ({
  requiredConfigValid: true,
  httpsEnforced: true,
  secureCookies: true,
  rlsEnabled: true,
  backupsConfigured: true,
  migrationsApplied: true,
  killSwitchDefaultSafe: true,
  modeBHeld: true,
  autonomousOptimizationDisabled: true,
  debugDisabled: true,
  runtimeMode: 'LIVE_WRITE_DISABLED',
  securityHeaders: allHeaders(),
  readinessProbeExposed: true,
  ...o,
});

describe('C.6-36 — deployment readiness fails closed', () => {
  it('empty facts are NOT ready (readiness never assumed)', () => {
    const r = evaluateDeploymentReadiness({});
    expect(r.ready).toBe(false);
    // every critical check reports unknown when its fact is absent
    expect(r.checks.filter((c) => c.severity === 'CRITICAL').every((c) => !c.pass && c.reason === 'unknown')).toBe(true);
  });

  it('a complete safe fact set is ready', () => {
    const r = evaluateDeploymentReadiness(readyFacts());
    expect(r.ready).toBe(true);
    expect(blockingChecks(r)).toHaveLength(0);
  });

  it('any single absent CRITICAL fact blocks readiness (fail closed)', () => {
    const facts = readyFacts();
    delete (facts as Record<string, unknown>).rlsEnabled;
    const r = evaluateDeploymentReadiness(facts);
    expect(r.ready).toBe(false);
    expect(blockingChecks(r).map((c) => c.id)).toContain('rls_enabled');
    expect(r.checks.find((c) => c.id === 'rls_enabled')?.reason).toBe('unknown');
  });

  it('an explicit false CRITICAL fact blocks readiness with not_satisfied', () => {
    const r = evaluateDeploymentReadiness(readyFacts({ modeBHeld: false }));
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.id === 'mode_b_held')?.reason).toBe('not_satisfied');
  });

  it('a failing WARNING does not block readiness', () => {
    const r = evaluateDeploymentReadiness(readyFacts({ readinessProbeExposed: false }));
    expect(r.ready).toBe(true);
    const probe = r.checks.find((c) => c.id === 'readiness_probe_exposed');
    expect(probe?.severity).toBe('WARNING');
    expect(probe?.pass).toBe(false);
  });

  it('a missing security header blocks readiness in production', () => {
    const headers = allHeaders();
    headers['Content-Security-Policy'] = false;
    const r = evaluateDeploymentReadiness(readyFacts({ securityHeaders: headers }));
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.id === 'security_headers')?.reason).toBe('missing:1');
  });

  it('security-header gap is WARNING on staging but CRITICAL in production', () => {
    const facts = readyFacts({ securityHeaders: undefined });
    expect(evaluateDeploymentReadiness(facts, { profile: 'production' }).ready).toBe(false);
    // on staging the header check downgrades to WARNING, so the rest can still be ready
    const staging = evaluateDeploymentReadiness(facts, { profile: 'staging' });
    expect(staging.checks.find((c) => c.id === 'security_headers')?.severity).toBe('WARNING');
    expect(staging.ready).toBe(true);
  });

  it('an unrecognized runtime mode is unsafe', () => {
    // a value outside the known safe set fails closed with unsafe_mode
    const r = evaluateDeploymentReadiness(readyFacts({ runtimeMode: 'SOMETHING_ELSE' as never }));
    expect(r.checks.find((c) => c.id === 'runtime_mode_production_safe')?.reason).toBe('unsafe_mode');
    expect(r.ready).toBe(false);
  });

  it('readinessGate mirrors evaluate().ready', () => {
    expect(readinessGate(readyFacts())).toBe(true);
    expect(readinessGate({})).toBe(false);
  });

  it('documentation-derived constants are stated', () => {
    expect(REQUIRED_SECURITY_HEADERS).toContain('Strict-Transport-Security');
    expect(SECURE_COOKIE_FLAGS).toEqual({ secure: true, httpOnly: true, sameSite: 'lax' });
    expect(PRODUCTION_SAFE_RUNTIME_MODES).toContain('DEMO');
    expect(EXPECTED_SAFE_DEPLOYMENT).toEqual({ modeBHeld: true, autonomousOptimizationDisabled: true, killSwitchDefaultSafe: true });
  });
});

// ---- ITEM 37 — config/env shape validation ----
describe('C.6-37 — format checks are pure', () => {
  it('validates absolute http(s) URLs', () => {
    expect(isValidUrl('https://engine.example.com/api')).toBe(true);
    expect(isValidUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isValidUrl('ftp://x')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
  });
  it('validates bare origins (no path/query/fragment)', () => {
    expect(isValidOrigin('https://app.example.com')).toBe(true);
    expect(isValidOrigin('https://app.example.com/')).toBe(true);
    expect(isValidOrigin('https://app.example.com:8443')).toBe(true);
    expect(isValidOrigin('https://app.example.com/path')).toBe(false);
    expect(isValidOrigin('https://app.example.com?x=1')).toBe(false);
  });
});

describe('C.6-37 — redacted echo never reveals a value', () => {
  it('reports presence + length band only', () => {
    const e = redactedEcho('MARKTING_ENGINE_TOKEN', 'super-secret-token-value');
    expect(e).toEqual({ key: 'MARKTING_ENGINE_TOKEN', present: true, band: 'medium' });
    expect(JSON.stringify(e)).not.toContain('super-secret');
  });
  it('bands are deterministic around the documented bounds', () => {
    expect(lengthBand(undefined)).toBe('absent');
    expect(lengthBand('')).toBe('empty');
    expect(lengthBand('a'.repeat(LENGTH_BAND_BOUNDS.short - 1))).toBe('short');
    expect(lengthBand('a'.repeat(LENGTH_BAND_BOUNDS.medium - 1))).toBe('medium');
    expect(lengthBand('a'.repeat(LENGTH_BAND_BOUNDS.medium))).toBe('long');
  });
  it('a map echo sorts keys and omits values', () => {
    const echo = redactedEchoMap({ B: 'x', A: 'yy', C: undefined });
    expect(echo.map((e) => e.key)).toEqual(['A', 'B', 'C']);
    expect(echo.find((e) => e.key === 'C')?.present).toBe(false);
  });
});

describe('C.6-37 — schema validation (production vs dev)', () => {
  const prodValid: ConfigMap = {
    MARKTING_ENGINE_URL: 'https://engine.example.com',
    MARKTING_ENGINE_TOKEN: 'a-sufficiently-long-token',
    MARKTING_ALLOW_SELF_APPROVAL: 'false',
    MARKTING_ENGINE_TIMEOUT_MS: '240000',
  };

  it('a valid production config passes', () => {
    const r = validateMarktingConfig(prodValid, 'production');
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('production requires the secret token; dev does not', () => {
    const map: ConfigMap = { MARKTING_ENGINE_URL: 'https://engine.example.com' };
    const prod = validateMarktingConfig(map, 'production');
    expect(prod.valid).toBe(false);
    expect(prod.errors.find((e) => e.key === 'MARKTING_ENGINE_TOKEN')?.code).toBe('MISSING_REQUIRED');
    expect(validateMarktingConfig(map, 'dev').valid).toBe(true);
  });

  it('demo fixture is disallowed in production but fine in dev', () => {
    const map: ConfigMap = { ...prodValid, MARKTING_DEMO_MODE: 'true' };
    const prod = validateMarktingConfig(map, 'production');
    expect(prod.errors.find((e) => e.key === 'MARKTING_DEMO_MODE')?.code).toBe('DEMO_FIXTURE_IN_PRODUCTION');
    expect(validateMarktingConfig(map, 'dev').valid).toBe(true);
  });

  it('a secret length-band error never reveals the value or its length', () => {
    const map: ConfigMap = { ...prodValid, MARKTING_ENGINE_TOKEN: 'short' };
    const r = validateMarktingConfig(map, 'production');
    const err = r.errors.find((e) => e.key === 'MARKTING_ENGINE_TOKEN');
    expect(err?.code).toBe('KEY_LENGTH_OUT_OF_BAND');
    expect(err?.detail).toBe('length outside the expected band');
    expect(err?.detail).not.toContain('5');
    expect(err?.detail).not.toContain('short');
  });

  it('bad URL, bad enum, and bad integer band are typed errors', () => {
    const map: ConfigMap = {
      MARKTING_ENGINE_URL: 'nope',
      MARKTING_ENGINE_TOKEN: 'a-sufficiently-long-token',
      MARKTING_ALLOW_SELF_APPROVAL: 'maybe',
      MARKTING_ENGINE_TIMEOUT_MS: '1',
    };
    const r = validateConfig(MARKTING_CONFIG_SCHEMA, map, 'production');
    const byKey = Object.fromEntries(r.errors.map((e) => [e.key, e.code]));
    expect(byKey.MARKTING_ENGINE_URL).toBe('INVALID_URL');
    expect(byKey.MARKTING_ALLOW_SELF_APPROVAL).toBe('NOT_IN_ENUM');
    expect(byKey.MARKTING_ENGINE_TIMEOUT_MS).toBe('INTEGER_OUT_OF_BAND');
  });

  it('a non-integer timeout is NOT_INTEGER', () => {
    const map: ConfigMap = { ...prodValid, MARKTING_ENGINE_TIMEOUT_MS: '24.5' };
    const r = validateMarktingConfig(map, 'production');
    expect(r.errors.find((e) => e.key === 'MARKTING_ENGINE_TIMEOUT_MS')?.code).toBe('NOT_INTEGER');
  });

  it('rejectUnknown flags out-of-schema keys', () => {
    const schema: ConfigSchema = { A: { format: 'string', required: true } };
    const r = validateConfig(schema, { A: 'ok', STRAY: 'x' }, 'production', { rejectUnknown: true });
    expect(r.errors.find((e) => e.key === 'STRAY')?.code).toBe('UNKNOWN_KEY');
  });

  it('errors are deterministically ordered by key then code', () => {
    const r = validateConfig(MARKTING_CONFIG_SCHEMA, { MARKTING_ENGINE_URL: 'nope' }, 'production');
    const keys = r.errors.map((e) => e.key);
    expect(keys).toEqual([...keys].sort());
  });
});
