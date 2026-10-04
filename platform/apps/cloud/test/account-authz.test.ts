import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantOwnsAccount, authorizeTenantAccount } from '@/lib/cloud/account-authz';
import { SEED_PORTFOLIO } from '@/lib/markting/orchestrator/seed';

/**
 * PHASE C0.1 — the canonical tenant↔account guard, DEMO branch (no database). In DEMO the synthetic seed
 * portfolio is the complete universe of accounts, so ownership is membership in that portfolio and an
 * unknown id is denied identically to a cross-tenant one (both notFound). The live DB-backed branch is
 * proven in test/account-authz.database.test.ts.
 */
describe('account authz guard — DEMO branch (seed portfolio is the whole universe)', () => {
  let prevMode: string | undefined;
  const SEED_ACCOUNT = SEED_PORTFOLIO[0]!.account.accountId;

  beforeAll(() => {
    prevMode = process.env.MARKTING_RUNTIME_MODE;
    process.env.MARKTING_RUNTIME_MODE = 'DEMO';
  });
  afterAll(() => {
    if (prevMode === undefined) delete process.env.MARKTING_RUNTIME_MODE;
    else process.env.MARKTING_RUNTIME_MODE = prevMode;
  });

  it('every seeded account is owned', async () => {
    for (const client of SEED_PORTFOLIO) {
      expect(await tenantOwnsAccount({ organizationId: 'any-org-in-demo' }, client.account.accountId)).toBe(true);
    }
  });

  it('an unknown account id is NOT owned (C0.3 — no implicit primary fallback)', async () => {
    expect(await tenantOwnsAccount({ organizationId: 'any-org-in-demo' }, 'sandbox:acc:does-not-exist')).toBe(false);
    expect(await tenantOwnsAccount({ organizationId: 'any-org-in-demo' }, undefined)).toBe(false);
    expect(await tenantOwnsAccount({ organizationId: 'any-org-in-demo' }, '')).toBe(false);
  });

  it('authorizeTenantAccount passes for a seeded account and throws notFound for an unknown one', async () => {
    await expect(authorizeTenantAccount({ organizationId: 'any-org-in-demo' }, SEED_ACCOUNT)).resolves.toBeUndefined();
    await expect(authorizeTenantAccount({ organizationId: 'any-org-in-demo' }, 'sandbox:acc:unknown')).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK'),
    });
  });
});
