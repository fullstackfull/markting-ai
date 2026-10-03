import { describe, expect, it } from 'vitest';
import { revalidateAtApply } from '@/lib/markting/ops/approval-policy';
import { validateProposedAction, type TypedProposedAction } from '@/lib/markting/ops/actions';
import { operationDigest } from '@/lib/markting/ops/idempotency';
import { resolveClientScope, type AgencyMembership } from '@/lib/markting/ops/agency';
import { relevantSwitches, accountSwitchKey } from '@/lib/markting/ops/kill-switch';

const future = new Date(Date.now() + 3_600_000).toISOString();
const preview = { operationDigest: 'D', targetOwnershipOk: true, providerEntityExists: true, currentBudgetMinor: 10000, currency: 'SAR', entityStatus: 'ACTIVE' as const, policyVersion: 'v1', approvalExpiresAt: future };
const liveFull = { targetOwnershipOk: true, providerEntityExists: true, currentBudgetMinor: 10000, currency: 'SAR', entityStatus: 'ACTIVE' as const, policyVersion: 'v1', operationDigest: 'D' };

describe('Phase-7 red-team fixes', () => {
  // F1 — revalidation FAILS CLOSED when a required live value is missing.
  it('F1: missing current budget at apply time → REPREVIEW_REQUIRED when current_value is required', () => {
    const live = { ...liveFull, currentBudgetMinor: undefined };
    const r = revalidateAtApply(preview, live, { requiredChecks: ['target_ownership', 'entity_exists', 'currency_match', 'current_value'] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('REPREVIEW_REQUIRED'); expect(r.reasons.join(' ')).toMatch(/current budget could not be read/); }
  });
  it('F1: missing currency at apply time → REPREVIEW_REQUIRED when currency_match is required', () => {
    const r = revalidateAtApply(preview, { ...liveFull, currency: undefined }, { requiredChecks: ['currency_match'] });
    expect(r.ok).toBe(false);
  });
  it('F1: full live snapshot still validates ok', () => {
    expect(revalidateAtApply(preview, liveFull, { requiredChecks: ['target_ownership', 'entity_exists', 'currency_match', 'current_value'] }).ok).toBe(true);
  });

  // F5 — budget delta cap cannot be bypassed by omitting fromMinor.
  it('F5: SET_DAILY_BUDGET without fromMinor is rejected (cap cannot be evaluated)', () => {
    const noFrom: TypedProposedAction = { type: 'SET_DAILY_BUDGET', provider: 'meta', accountId: 'a', entityId: 'c1', entityLevel: 'campaign', budget: { toMinor: 1_000_000, currency: 'SAR' } };
    const r = validateProposedAction(noFrom, 'PLATFORM_REPORTED');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(' ')).toMatch(/current value \(fromMinor\)/);
  });
  it('F5: fromMinor is bound into the operation digest (baseline cannot be swapped)', () => {
    const base: TypedProposedAction = { type: 'SET_DAILY_BUDGET', provider: 'meta', accountId: 'a', entityId: 'c1', entityLevel: 'campaign', budget: { toMinor: 12000, fromMinor: 10000, currency: 'SAR' } };
    const swapped: TypedProposedAction = { ...base, budget: { toMinor: 12000, fromMinor: 2000, currency: 'SAR' } };
    expect(operationDigest(base, 'v1')).not.toBe(operationDigest(swapped, 'v1'));
  });

  // F4 — agency sub-scope: a workspace/account must belong under the requested client.
  it('F4: a workspace not under the client is refused even if the client is granted', () => {
    const m: AgencyMembership = { userId: 'u', agencyId: 'ag', clientOrganizationIds: ['A', 'B'], role: 'AGENCY_ADMIN', scopeGraph: { A: { workspaces: ['wsA'], accounts: ['actA'] }, B: { workspaces: ['wsB'], accounts: ['actB'] } } };
    expect(resolveClientScope(m, { agencyId: 'ag', clientOrganizationId: 'A', workspaceId: 'wsB' }).allowed).toBe(false);
    expect(resolveClientScope(m, { agencyId: 'ag', clientOrganizationId: 'A', accountId: 'actB' }).allowed).toBe(false);
    expect(resolveClientScope(m, { agencyId: 'ag', clientOrganizationId: 'A', workspaceId: 'wsA', accountId: 'actA' }).allowed).toBe(true);
  });

  // F2 — ACCOUNT kill-switch key is org-qualified (no cross-tenant collision/overwrite).
  it('F2: ACCOUNT kill-switch key embeds the org', () => {
    expect(accountSwitchKey('orgA', 'act_1')).toBe('orgA:act_1');
    const keys = relevantSwitches({ organizationId: 'orgA', provider: 'meta', accountId: 'act_1', actionType: 'PAUSE_ENTITY' });
    expect(keys.find((k) => k.scope === 'ACCOUNT')!.key).toBe('orgA:act_1');
    // a different org targeting the same account id gets a different key → no collision
    const keysB = relevantSwitches({ organizationId: 'orgB', provider: 'meta', accountId: 'act_1', actionType: 'PAUSE_ENTITY' });
    expect(keysB.find((k) => k.scope === 'ACCOUNT')!.key).toBe('orgB:act_1');
  });
});
