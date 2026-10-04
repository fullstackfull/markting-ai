import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import {
  classifyForQuarantine,
  partitionForQuarantine,
  ingestWithQuarantine,
  InMemoryQuarantineStore,
  PostgresQuarantineStore,
  redactSample,
  QUARANTINE_REASONS,
  type QuarantineContext,
} from '@/lib/markting/ops/quarantine';
import type { ProviderContract } from '@/lib/markting/ops/schema-drift';

/**
 * PHASE C.6 (item 5) — data quarantine. The PURE classifier for each reason, the in-memory store
 * round-trip, and the INVARIANT that quarantined rows never reach the accepted (canonical) set. DB
 * round-trip is gated on the cloud-db lane.
 */

const NOW = Date.UTC(2026, 9, 4);
const CONTRACT: ProviderContract = {
  provider: 'meta',
  version: 'v19.0',
  fields: [
    { path: 'id', type: 'string', required: true },
    { path: 'spend', type: 'string', required: true },
  ],
};
const baseCtx: QuarantineContext = {
  provider: 'meta',
  expectedOrganizationId: 'org-1',
  expectedAccountId: 'acct-1',
  supportedCurrencies: ['USD', 'EUR', 'SAR'],
  nowMs: NOW,
};

describe('classifyForQuarantine — one trigger per reason', () => {
  it('accepts a clean, in-contract row', () => {
    const row = { id: 'x', spend: '12.50', impressions: 100, clicks: 4, currency: 'USD', organizationId: 'org-1', accountId: 'acct-1', timestamp: NOW - 1000 };
    expect(classifyForQuarantine(row, baseCtx)).toEqual({ quarantined: false });
  });

  it('MALFORMED_ROW — non-object / empty object', () => {
    expect(classifyForQuarantine(null, baseCtx).reason).toBe('MALFORMED_ROW');
    expect(classifyForQuarantine([1, 2], baseCtx).reason).toBe('MALFORMED_ROW');
    expect(classifyForQuarantine('nope', baseCtx).reason).toBe('MALFORMED_ROW');
    expect(classifyForQuarantine({}, baseCtx).reason).toBe('MALFORMED_ROW');
  });

  it('SCHEMA_DRIFT — breaking drift against the contract (missing required field)', () => {
    const d = classifyForQuarantine({ id: 'x' /* spend missing */ }, { ...baseCtx, contract: CONTRACT });
    expect(d.quarantined).toBe(true);
    expect(d.reason).toBe('SCHEMA_DRIFT');
  });

  it('SCHEMA_DRIFT — additive drift alone is NOT quarantined', () => {
    const d = classifyForQuarantine({ id: 'x', spend: '1', extra: 'new' }, { ...baseCtx, contract: CONTRACT });
    expect(d.quarantined).toBe(false);
  });

  it('IMPOSSIBLE_VALUE — negative, non-finite, and clicks > impressions', () => {
    expect(classifyForQuarantine({ id: 'x', spend: -1 }, baseCtx).reason).toBe('IMPOSSIBLE_VALUE');
    expect(classifyForQuarantine({ id: 'x', impressions: Number.POSITIVE_INFINITY }, baseCtx).reason).toBe('IMPOSSIBLE_VALUE');
    expect(classifyForQuarantine({ id: 'x', clicks: 10, impressions: 3 }, baseCtx).reason).toBe('IMPOSSIBLE_VALUE');
  });

  it('OWNERSHIP_MISMATCH — row attributed to a different org or account', () => {
    expect(classifyForQuarantine({ id: 'x', organizationId: 'org-2' }, baseCtx).reason).toBe('OWNERSHIP_MISMATCH');
    expect(classifyForQuarantine({ id: 'x', account_id: 'acct-9' }, baseCtx).reason).toBe('OWNERSHIP_MISMATCH');
  });

  it('UNSUPPORTED_CURRENCY — currency outside the accounting set', () => {
    expect(classifyForQuarantine({ id: 'x', currency: 'JPY' }, baseCtx).reason).toBe('UNSUPPORTED_CURRENCY');
    // case-insensitive membership
    expect(classifyForQuarantine({ id: 'x', currencyCode: 'usd' }, baseCtx).quarantined).toBe(false);
  });

  it('INVALID_TIMESTAMP — unparseable, pre-2000, or far future', () => {
    expect(classifyForQuarantine({ id: 'x', timestamp: 'not-a-date' }, baseCtx).reason).toBe('INVALID_TIMESTAMP');
    expect(classifyForQuarantine({ id: 'x', occurredAt: Date.UTC(1990, 0, 1) }, baseCtx).reason).toBe('INVALID_TIMESTAMP');
    expect(classifyForQuarantine({ id: 'x', date: NOW + 30 * 24 * 60 * 60 * 1000 }, baseCtx).reason).toBe('INVALID_TIMESTAMP');
  });

  it('every reason constant is reachable by the classifier', () => {
    const produced = new Set<string>();
    const samples: Array<[unknown, QuarantineContext]> = [
      [null, baseCtx],
      [{ id: 'x' }, { ...baseCtx, contract: CONTRACT }],
      [{ id: 'x', spend: -5 }, baseCtx],
      [{ id: 'x', organizationId: 'other' }, baseCtx],
      [{ id: 'x', currency: 'XYZ' }, baseCtx],
      [{ id: 'x', timestamp: 'bad' }, baseCtx],
    ];
    for (const [row, ctx] of samples) {
      const d = classifyForQuarantine(row, ctx);
      if (d.reason) produced.add(d.reason);
    }
    expect([...produced].sort()).toEqual([...QUARANTINE_REASONS].sort());
  });
});

describe('invariant — quarantined rows never reach the accepted set', () => {
  it('partitionForQuarantine routes every bad row away from accepted', () => {
    const rows = [
      { id: 'ok', spend: '1', currency: 'USD', organizationId: 'org-1', accountId: 'acct-1' },
      null,
      { id: 'neg', spend: -1 },
      { id: 'mism', organizationId: 'org-9' },
      { id: 'cur', currency: 'JPY' },
      { id: 'ok2', spend: '2', currency: 'EUR' },
    ];
    const { accepted, quarantined } = partitionForQuarantine(rows, baseCtx);
    expect(quarantined).toHaveLength(4);
    // The defining invariant: NOTHING in accepted classifies as quarantined.
    for (const row of accepted) expect(classifyForQuarantine(row, baseCtx).quarantined).toBe(false);
    expect(accepted.map((r: any) => r.id)).toEqual(['ok', 'ok2']);
  });
});

describe('redaction — the only thing a store ever persists is scrubbed', () => {
  it('redactSample removes secrets/PII but keeps shape', () => {
    const scrubbed: any = redactSample({ id: 'x', access_token: 'ya29.secret-value', customer_email: 'a@b.com', spend: 12 }, 'meta');
    expect(scrubbed.id).toBe('x');
    expect(scrubbed.spend).toBe(12);
    expect(scrubbed.access_token).toBe('[REDACTED]');
    expect(scrubbed.customer_email).toBe('[REDACTED]');
  });
});

describe('InMemoryQuarantineStore — round-trip + dedup', () => {
  it('records, deduplicates on (org, provider, account, reason) and persists only a redacted sample', async () => {
    const store = new InMemoryQuarantineStore();
    const obs = { organizationId: 'org-1', provider: 'meta', accountId: 'acct-1', reason: 'IMPOSSIBLE_VALUE' as const, nowMs: NOW };
    const a = await store.record({ ...obs, sampleRow: { id: '1', spend: -1, access_token: 'ya29.leak-me-please-0000' } });
    expect(a.count).toBe(1);
    const b = await store.record({ ...obs, nowMs: NOW + 5, sampleRow: { id: '2', spend: -2 } });
    expect(b.count).toBe(2);
    expect(b.firstSeenAtMs).toBe(NOW);
    expect(b.lastSeenAtMs).toBe(NOW + 5);
    expect((a.redactedSample as any).access_token).toBe('[REDACTED]');
    expect(store.all()).toHaveLength(1);

    // a different reason is a distinct aggregate row
    await store.record({ ...obs, reason: 'OWNERSHIP_MISMATCH', sampleRow: { id: '3' } });
    expect(store.all()).toHaveLength(2);
  });

  it('ingestWithQuarantine records every rejected row and returns only accepted', async () => {
    const store = new InMemoryQuarantineStore();
    const rows = [{ id: 'ok', spend: '1', currency: 'USD' }, { id: 'bad', spend: -1 }, null];
    const { accepted, quarantinedCount } = await ingestWithQuarantine(rows, baseCtx, {
      store, organizationId: 'org-1', accountId: 'acct-1', nowMs: NOW,
    });
    expect(quarantinedCount).toBe(2);
    expect(accepted).toHaveLength(1);
    expect(store.all().reduce((s, r) => s + r.count, 0)).toBe(2);
  });
});

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('PostgresQuarantineStore — durable aggregate (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const store = new PostgresQuarantineStore();
  const users: string[] = [];
  let org: string;

  beforeAll(async () => {
    const userId = randomUUID(); users.push(userId);
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`quar-${userId}@example.test`}, '{}'::jsonb)`;
    const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
    org = m!.organization_id;
  });
  afterAll(async () => {
    await admin`delete from public.markting_quarantine where organization_id = ${org}`.catch(() => {});
    for (const id of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin`delete from auth.users where id = ${id}`.catch(() => {});
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('upsert bumps count + last-seen; keeps first-seen; stores only a redacted sample', async () => {
    const a = await store.record({ organizationId: org, provider: 'meta', accountId: 'acct-1', reason: 'IMPOSSIBLE_VALUE', sampleRow: { id: '1', spend: -1, access_token: 'ya29.leak-me-please-0000' }, nowMs: NOW });
    expect(a.count).toBe(1);
    const b = await store.record({ organizationId: org, provider: 'meta', accountId: 'acct-1', reason: 'IMPOSSIBLE_VALUE', sampleRow: { id: '2', spend: -2 }, nowMs: NOW + 10 });
    expect(b.count).toBe(2);
    expect(b.firstSeenAtMs).toBe(NOW);
    expect(b.lastSeenAtMs).toBe(NOW + 10);
    expect((a.redactedSample as any).access_token).toBe('[REDACTED]');
    const rows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_quarantine where organization_id = ${org}`;
    expect(rows[0]!.count).toBe(1);
  });
});
