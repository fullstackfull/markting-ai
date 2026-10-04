import { describe, expect, it } from 'vitest';
import { sanitizeProviderResponse, REDACTED } from '@/lib/markting/ops/sanitize';

/**
 * PHASE C.5 (item 10) — proves the live-capture sanitizer scrubs every secret/PII class, keeps the
 * structural shape usable as a contract fixture, is idempotent, and stamps honest provenance.
 */

// A representative raw provider response: real-world mix of secrets, PII, customer ids, nested secrets,
// and legitimate structural/metric fields that MUST survive.
function rawResponse(): Record<string, unknown> {
  return {
    access_token: 'EAAG1234567890abcdefghijklmnopqrstuvwxyz0123456789',
    refresh_token: 'rt_9876543210zyxwvutsrqponmlkjihgfedcba9876543210',
    token_type: 'bearer',
    account_id: 'act_123456789', // structural identifier — keep
    campaign_name: 'Summer Sale 2026', // structural label — keep
    currency: 'SAR',
    data: [
      {
        campaign_id: 'c_1',
        campaign_name: 'Ramadan Push',
        spend: 1234.56,
        impressions: 98765,
        clicks: 4321,
        active: true,
        owner: {
          first_name: 'Layla',
          last_name: 'Al-Rashid',
          email: 'layla@example.com',
          phone: '+966500000000',
          customer_id: 'cust_abc123',
          address: '12 King Fahd Rd, Riyadh',
        },
        contact_email: 'ops@example.com',
      },
    ],
    paging: {
      cursors: {
        authorization: { header: 'Bearer secret-inner-token-value' }, // nested secret subtree
        after: 'cursor_opaque_page_token_value',
      },
    },
    nullable_field: null,
  };
}

const OPTS = { provider: 'meta', apiVersion: 'v23.0', captureDate: '2026-10-04' };

describe('sanitizeProviderResponse — secret/PII removal', () => {
  it('redacts access/refresh tokens by key', () => {
    const { sanitized } = sanitizeProviderResponse(rawResponse(), OPTS) as { sanitized: Record<string, unknown> };
    expect(sanitized.access_token).toBe(REDACTED);
    expect(sanitized.refresh_token).toBe(REDACTED);
  });

  it('redacts emails, phone, address, personal names and customer ids', () => {
    const { sanitized } = sanitizeProviderResponse(rawResponse(), OPTS) as { sanitized: Record<string, unknown> };
    const owner = (sanitized.data as Array<Record<string, unknown>>)[0]!.owner as Record<string, unknown>;
    expect(owner.first_name).toBe(REDACTED);
    expect(owner.last_name).toBe(REDACTED);
    expect(owner.email).toBe(REDACTED);
    expect(owner.phone).toBe(REDACTED);
    expect(owner.address).toBe(REDACTED);
    expect(owner.customer_id).toBe(REDACTED);
  });

  it('redacts an email even under a non-obvious key (value heuristic)', () => {
    const { sanitized } = sanitizeProviderResponse({ note: 'reach me at person@mail.io', weird: 'a@b.co' }, OPTS) as {
      sanitized: Record<string, unknown>;
    };
    // whole-string email value is redacted
    expect(sanitized.weird).toBe(REDACTED);
    // a free-text string that merely contains an email is left (not a bare email) — acceptable, key heuristic governs
    expect(typeof sanitized.note).toBe('string');
  });

  it('redacts nested secret subtrees entirely', () => {
    const { sanitized } = sanitizeProviderResponse(rawResponse(), OPTS) as { sanitized: Record<string, unknown> };
    const cursors = (sanitized.paging as Record<string, unknown>).cursors as Record<string, unknown>;
    // the whole `authorization` subtree collapses to the sentinel — no inner value survives
    expect(cursors.authorization).toBe(REDACTED);
  });
});

describe('sanitizeProviderResponse — structural preservation', () => {
  it('keeps non-sensitive structural keys and scalar shapes', () => {
    const { sanitized } = sanitizeProviderResponse(rawResponse(), OPTS) as { sanitized: Record<string, unknown> };
    expect(sanitized.account_id).toBe('act_123456789');
    expect(sanitized.campaign_name).toBe('Summer Sale 2026');
    expect(sanitized.currency).toBe('SAR');
    expect(sanitized.nullable_field).toBeNull();

    const row = (sanitized.data as Array<Record<string, unknown>>)[0]!;
    expect(row.campaign_id).toBe('c_1');
    expect(row.campaign_name).toBe('Ramadan Push');
    expect(row.spend).toBe(1234.56);
    expect(row.impressions).toBe(98765);
    expect(row.clicks).toBe(4321);
    expect(row.active).toBe(true);
  });

  it('preserves array/object nesting (same keys and indices)', () => {
    const { sanitized } = sanitizeProviderResponse(rawResponse(), OPTS) as { sanitized: Record<string, unknown> };
    expect(Array.isArray(sanitized.data)).toBe(true);
    expect((sanitized.data as unknown[]).length).toBe(1);
    const owner = (sanitized.data as Array<Record<string, unknown>>)[0]!.owner as Record<string, unknown>;
    // keys are preserved even though values are redacted
    expect(Object.keys(owner).sort()).toEqual(
      ['address', 'customer_id', 'email', 'first_name', 'last_name', 'phone'].sort(),
    );
  });

  it('does not mutate the input', () => {
    const input = rawResponse();
    sanitizeProviderResponse(input, OPTS);
    expect(input.access_token).toBe('EAAG1234567890abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('sanitizeProviderResponse — idempotency & provenance', () => {
  it('is idempotent (sanitizing a sanitized payload is a no-op)', () => {
    const once = sanitizeProviderResponse(rawResponse(), OPTS);
    const twice = sanitizeProviderResponse(once.sanitized, OPTS);
    expect(twice.sanitized).toEqual(once.sanitized);
  });

  it('stamps honest provenance with sanitized:true', () => {
    const { provenance } = sanitizeProviderResponse(rawResponse(), OPTS);
    expect(provenance.provider).toBe('meta');
    expect(provenance.apiVersion).toBe('v23.0');
    expect(provenance.captureDate).toBe('2026-10-04');
    expect(provenance.sanitized).toBe(true);
  });

  it('defaults captureDate to an ISO date when not supplied', () => {
    const { provenance } = sanitizeProviderResponse({ ok: 1 }, { provider: 'google', apiVersion: 'v17' });
    expect(provenance.captureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(provenance.sanitized).toBe(true);
  });
});
