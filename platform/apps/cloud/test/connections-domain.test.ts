import { describe, expect, it } from 'vitest';
import { CONNECTION_ERROR_CLASSES, CONNECTION_STATUSES, ERROR_REMEDIATION, statusTone, statusIsOperational } from '@/lib/connections/vocabulary';
import { classifyConnectionError, errorRequiresReauth } from '@/lib/connections/classify';
import { deriveConnectionStatus, deriveConnectionHealth } from '@/lib/connections/status';
import { connectionRegistry, allRegistryEntries, AD_PROVIDERS } from '@/lib/connections/registry';
import { CONNECTION_CONTRACT_FIXTURES } from './fixtures/connection-contract-provenance';

/**
 * CONNECTIONS CONTROL PLANE — pure domain tests (node lane). Status/health/error are DETERMINISTIC:
 * these assert the canonical vocabulary, the registry facts (grounded in the adapter audit) and the
 * precedence rules, with no DB and no model.
 */
describe('connection vocabulary + remediation', () => {
  it('every error class has a deterministic remediation', () => {
    for (const cls of CONNECTION_ERROR_CLASSES) {
      expect(ERROR_REMEDIATION[cls]?.action, cls).toBeTruthy();
      expect(ERROR_REMEDIATION[cls]?.detail, cls).toBeTruthy();
    }
  });
  it('status tones and operational flags are coherent', () => {
    expect(statusTone('CONNECTED')).toBe('ok');
    expect(statusTone('EXPIRED')).toBe('bad');
    expect(statusTone('REAUTH_REQUIRED')).toBe('warn');
    expect(statusIsOperational('CONNECTED')).toBe(true);
    expect(statusIsOperational('EXPIRED')).toBe(false);
    expect(CONNECTION_STATUSES).toContain('BLOCKED_EXTERNAL');
  });
});

describe('classifyConnectionError (deterministic taxonomy)', () => {
  const cases: Array<[string, string]> = [
    ['HTTP 429 Too Many Requests', 'RATE_LIMIT'],
    ['invalid_grant: token expired', 'TOKEN_EXPIRED'],
    ['401 Unauthorized malformed access token', 'AUTH_ERROR'],
    ['user_permission_denied (403)', 'PERMISSION_ERROR'],
    ['advertiser is disabled', 'ACCOUNT_DISABLED'],
    ['unknown field "foo" — unsupported version', 'SCHEMA_CHANGED'],
    ['signature verification failed on webhook', 'WEBHOOK_ERROR'],
    ['sync failed: dead-letter', 'SYNC_ERROR'],
    ['HTTP 503 Service Unavailable', 'PROVIDER_5XX'],
    ['ECONNRESET socket hang up', 'NETWORK_ERROR'],
    ['400 invalid request: validation failed', 'INVALID_REQUEST'],
    ['something totally unmatchable zzz', 'UNKNOWN'],
  ];
  for (const [raw, expected] of cases) {
    it(`classifies "${raw}" → ${expected}`, () => {
      expect(classifyConnectionError(raw).errorClass).toBe(expected);
    });
  }
  it('accepts a known class string as-is', () => {
    expect(classifyConnectionError('RATE_LIMIT').errorClass).toBe('RATE_LIMIT');
  });
  it('maps reauth-worthy classes', () => {
    expect(errorRequiresReauth('TOKEN_EXPIRED')).toBe(true);
    expect(errorRequiresReauth('RATE_LIMIT')).toBe(false);
  });
});

describe('deriveConnectionStatus precedence', () => {
  it('expired token wins over a connected base', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(deriveConnectionStatus({ baseStatus: 'connected', hasCredential: true, tokenExpiresAt: past }).status).toBe('EXPIRED');
  });
  it('disabled wins over everything', () => {
    expect(deriveConnectionStatus({ baseStatus: 'connected', hasCredential: true, disabled: true }).status).toBe('DISABLED');
  });
  it('reauth required surfaces when flagged', () => {
    expect(deriveConnectionStatus({ baseStatus: 'connected', hasCredential: true, reauthRequired: true }).status).toBe('REAUTH_REQUIRED');
  });
  it('missing scopes → INSUFFICIENT_PERMISSIONS', () => {
    expect(deriveConnectionStatus({ baseStatus: 'connected', hasCredential: true, missingScopeCount: 2 }).status).toBe('INSUFFICIENT_PERMISSIONS');
  });
  it('error class maps to a canonical status', () => {
    expect(deriveConnectionStatus({ baseStatus: 'error', hasCredential: true, errorClass: 'RATE_LIMIT' }).status).toBe('RATE_LIMITED');
    expect(deriveConnectionStatus({ baseStatus: 'error', hasCredential: true, errorClass: 'SCHEMA_CHANGED' }).status).toBe('SCHEMA_CHANGED');
  });
  it('no credential and nothing configured → NOT_CONFIGURED', () => {
    expect(deriveConnectionStatus({ available: true }).status).toBe('NOT_CONFIGURED');
  });
  it('a clean connected grant → CONNECTED', () => {
    expect(deriveConnectionStatus({ baseStatus: 'connected', hasCredential: true }).status).toBe('CONNECTED');
  });
  it('health derivation is deterministic and reuses the provider-health machine', () => {
    expect(deriveConnectionHealth({ disabled: true }).state).toBe('DISABLED');
    expect(deriveConnectionHealth({ lastProbeOk: true }).state).toBe('CONNECTED');
  });
});

describe('provider capability registry (grounded in the adapter audit)', () => {
  it('covers all 11 ad providers', () => {
    expect(AD_PROVIDERS).toHaveLength(11);
  });
  it('encodes known refresh facts (no refresh for long-lived/OAuth1 providers)', () => {
    expect(connectionRegistry('tiktok')?.capabilities.refresh).toBe(false);
    expect(connectionRegistry('meta')?.capabilities.refresh).toBe(false);
    expect(connectionRegistry('x')?.capabilities.refresh).toBe(false);
    expect(connectionRegistry('google')?.capabilities.refresh).toBe(true);
  });
  it('encodes known revoke facts (server-side vs manual)', () => {
    expect(connectionRegistry('google')?.capabilities.revokeProviderSide).toBe(true);
    expect(connectionRegistry('apple')?.capabilities.revokeProviderSide).toBe(false);
    expect(connectionRegistry('linkedin')?.capabilities.revokeProviderSide).toBe(false);
  });
  it('only google/meta expose a server-side dry-run', () => {
    expect(connectionRegistry('google')?.capabilities.serverDryRun).toBe(true);
    expect(connectionRegistry('meta')?.capabilities.serverDryRun).toBe(true);
    expect(connectionRegistry('tiktok')?.capabilities.serverDryRun).toBe(false);
  });
  it('ad providers have no webhook; commerce has a webhook verifier but no live transport', () => {
    expect(connectionRegistry('google')?.capabilities.webhook).toBe(false);
    expect(connectionRegistry('shopify')?.capabilities.webhook).toBe(true);
    expect(connectionRegistry('shopify')?.liveTransportImplemented).toBe(false);
  });
  it('NO provider advertises scheduled/background refresh (reactive only, by design)', () => {
    for (const e of allRegistryEntries()) {
      if (e.id === 'mcp') continue; // MCP server schedules its own token purge
      expect(e.capabilities.scheduledRefresh, e.id).toBe(false);
    }
  });
});

describe('contract-fixture provenance is honestly classified for every adapter', () => {
  it('every ad + commerce provider has a provenance record with a valid label', () => {
    const providers = allRegistryEntries().filter((e) => e.category !== 'platform_service').map((e) => e.id);
    for (const p of providers) {
      const rec = CONNECTION_CONTRACT_FIXTURES.find((f) => f.provider === p);
      expect(rec, `provenance record for ${p}`).toBeTruthy();
      expect(['LIVE_CAPTURED', 'DOCUMENTATION_DERIVED', 'SYNTHETIC']).toContain(rec!.provenance);
    }
  });
  it('does NOT falsely claim any live-captured provider fixtures (none exist in-repo)', () => {
    expect(CONNECTION_CONTRACT_FIXTURES.some((f) => f.provenance === 'LIVE_CAPTURED')).toBe(false);
  });
});
