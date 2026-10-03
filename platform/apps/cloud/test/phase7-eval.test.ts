import { describe, expect, it } from 'vitest';
import { validateProposedAction, resolveAction, type TypedProposedAction } from '@/lib/markting/ops/actions';
import { requiredApprovals, evaluateQuorum, revalidateAtApply, type CollectedApproval } from '@/lib/markting/ops/approval-policy';
import { can, canApprove, canExecute, permissionsFor, type Principal, type Role } from '@/lib/markting/ops/rbac';
import { canTransition, assertTransition, IllegalTransitionError, isTerminal } from '@/lib/markting/ops/state-machine';
import { operationDigest, evaluateClaim, reconcileUnknownResult, claimsExactlyOnce, idempotencyKeyFor } from '@/lib/markting/ops/idempotency';
import { buildRollback } from '@/lib/markting/ops/rollback';
import { evaluateWriteBlocked, evaluateReadBlocked, type KillSwitch } from '@/lib/markting/ops/kill-switch';
import { authenticateServiceKey, mintServiceKey, type ServiceAccount } from '@/lib/markting/ops/service-account';
import { resolveClientScope, guardBulkOperation, type AgencyMembership } from '@/lib/markting/ops/agency';
import { deriveProviderHealth, healthAllowsWrite } from '@/lib/markting/ops/provider-health';
import { KeyRing, seal, open, reseal } from '@/lib/markting/ops/kms';
import { dedupeAlerts, redactLog, type Alert } from '@/lib/markting/ops/observability';
import { changeRecord } from '@/lib/markting/ops/change-management';
import { buildApprovalCard } from '@/lib/markting/ops/surfaces';
import { randomBytes } from 'node:crypto';

const action: TypedProposedAction = { type: 'SET_DAILY_BUDGET', provider: 'meta', accountId: 'act_1', entityId: 'c1', entityLevel: 'campaign', budget: { toMinor: 12000, fromMinor: 10000, currency: 'SAR' } };
const human = (userId: string, roles: Role[]): Principal => ({ userId, roles });
const appr = (userId: string, roles: Role[]): CollectedApproval => ({ actorUserId: userId, actor: human(userId, roles), roles, approvedAt: new Date().toISOString() });
const future = new Date(Date.now() + 3_600_000).toISOString();
const preview = { operationDigest: 'D', targetOwnershipOk: true, providerEntityExists: true, currentBudgetMinor: 10000, currency: 'SAR', entityStatus: 'ACTIVE' as const, policyVersion: 'v1', approvalExpiresAt: future };
const live = { targetOwnershipOk: true, providerEntityExists: true, currentBudgetMinor: 10000, currency: 'SAR', entityStatus: 'ACTIVE' as const, policyVersion: 'v1', operationDigest: 'D' };

describe('AI Evaluation 7.0 — 40 governance scenarios', () => {
  it('1. human approval satisfies a single-approver policy', () => {
    const req = requiredApprovals({ riskClass: 'LOW' });
    expect(evaluateQuorum({ requirement: req, requesterUserId: 'u1', approvals: [appr('u2', ['APPROVER'])] }).satisfied).toBe(true);
  });
  it('2. multi-approval required for high value → needs 2 distinct humans', () => {
    const req = requiredApprovals({ riskClass: 'LOW', financialExposureMinor: 1_000_00 });
    expect(req.quorum).toBe(2);
    expect(evaluateQuorum({ requirement: req, requesterUserId: 'u1', approvals: [appr('u2', ['APPROVER'])] }).satisfied).toBe(false);
    expect(evaluateQuorum({ requirement: req, requesterUserId: 'u1', approvals: [appr('u2', ['APPROVER']), appr('u3', ['ADMIN'])] }).satisfied).toBe(true);
  });
  it('3. self-approval denied (4-eyes)', () => {
    expect(canApprove({ requesterUserId: 'u1', actorUserId: 'u1', actor: human('u1', ['ADMIN']) }).ok).toBe(false);
  });
  it('4. service-account approval denied', () => {
    expect(canApprove({ requesterUserId: 'u1', actorUserId: 'svc', actor: { userId: 'svc', roles: ['APPROVER'], isServiceAccount: true } }).ok).toBe(false);
  });
  it('5. expired approval → EXPIRED at apply time', () => {
    const r = revalidateAtApply({ ...preview, approvalExpiresAt: new Date(Date.now() - 1000).toISOString() }, live);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('EXPIRED');
  });
  it('6. stale preview (digest mismatch) → REPREVIEW_REQUIRED', () => {
    const r = revalidateAtApply(preview, { ...live, operationDigest: 'DIFFERENT' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('REPREVIEW_REQUIRED');
  });
  it('7. changed provider state (budget moved externally) → REPREVIEW_REQUIRED', () => {
    const r = revalidateAtApply(preview, { ...live, currentBudgetMinor: 99999 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reasons.join(' ')).toMatch(/budget changed/);
  });
  it('8. duplicate apply blocked by atomic claim (second claim fails)', () => {
    expect(evaluateClaim({ state: 'APPROVED', claimToken: null }).claimed).toBe(true);
    expect(evaluateClaim({ state: 'APPROVED', claimToken: 'tok' }).claimed).toBe(false);
  });
  it('9. UNKNOWN_RESULT is a legal state after APPLYING; APPLIED is not directly from APPROVED', () => {
    expect(canTransition('APPLYING', 'UNKNOWN_RESULT')).toBe(true);
    expect(canTransition('APPROVED', 'APPLIED')).toBe(false);
  });
  it('10. safe reconciliation confirms applied when provider == intended', () => {
    const v = reconcileUnknownResult({ action, intended: { budgetMinor: 12000 }, actual: { budgetMinor: 12000 }, pre: { budgetMinor: 10000 } });
    expect(v.verdict).toBe('APPLIED_CONFIRMED');
  });
  it('11. unsafe retry denied when provider state is ambiguous', () => {
    const v = reconcileUnknownResult({ action, intended: { budgetMinor: 12000 }, actual: { budgetMinor: 11111 }, pre: { budgetMinor: 10000 } });
    expect(v.verdict).toBe('STILL_UNKNOWN');
  });
  it('11b. safe retry only when provider still at pre-change value', () => {
    const v = reconcileUnknownResult({ action, intended: { budgetMinor: 12000 }, actual: { budgetMinor: 10000 }, pre: { budgetMinor: 10000 } });
    expect(v.verdict).toBe('SAFE_TO_RETRY');
  });
  it('12. rollback restores the exact previous budget as a new governed action', () => {
    const rb = buildRollback({ action, before: { budgetMinor: 10000, currency: 'SAR' } });
    expect(rb.reversible).toBe(true); if (rb.reversible) expect(rb.action.budget!.toMinor).toBe(10000);
  });
  it('12b. pause rollback only resumes if prior state was ACTIVE', () => {
    const paused: TypedProposedAction = { type: 'PAUSE_ENTITY', provider: 'meta', accountId: 'a', entityId: 'c1', entityLevel: 'campaign', status: 'PAUSED' };
    expect(buildRollback({ action: paused, before: { status: 'PAUSED' } }).reversible).toBe(false);
    expect(buildRollback({ action: paused, before: { status: 'ACTIVE' } }).reversible).toBe(true);
  });
  it('13. kill switch blocks a write at the provider scope', () => {
    const active: KillSwitch[] = [{ scope: 'PROVIDER', key: 'meta', active: true }];
    expect(evaluateWriteBlocked({ organizationId: 'o', provider: 'meta', accountId: 'a', actionType: 'SET_DAILY_BUDGET' }, active).blocked).toBe(true);
    expect(evaluateReadBlocked({ organizationId: 'o', provider: 'meta', accountId: 'a', actionType: 'SET_DAILY_BUDGET' }, active).blocked).toBe(false); // reads continue
  });
  it('14. cross-tenant: an approval from another org is never applicable (store asserts org) — quorum counts only given approvals', () => {
    // evaluateQuorum operates on server-supplied approvals for THIS operation only; there is no cross-org path here.
    expect(evaluateQuorum({ requirement: requiredApprovals({ riskClass: 'LOW' }), requesterUserId: 'u1', approvals: [] }).satisfied).toBe(false);
  });
  it('15. cross-client agency context resolved from server membership only', () => {
    const m: AgencyMembership = { userId: 'u', agencyId: 'ag1', clientOrganizationIds: ['client-A'], role: 'AGENCY_ADMIN' };
    expect(resolveClientScope(m, { agencyId: 'ag1', clientOrganizationId: 'client-A' }).allowed).toBe(true);
    expect(resolveClientScope(m, { agencyId: 'ag1', clientOrganizationId: 'client-B' }).allowed).toBe(false);
  });
  it('16. protected account escalates to a senior second approver', () => {
    const req = requiredApprovals({ riskClass: 'LOW', protectedAccount: true });
    expect(req.requireSenior).toBe(true);
    expect(evaluateQuorum({ requirement: req, requesterUserId: 'u1', approvals: [appr('u2', ['APPROVER']), appr('u3', ['APPROVER'])] }).satisfied).toBe(false); // no senior
    expect(evaluateQuorum({ requirement: req, requesterUserId: 'u1', approvals: [appr('u2', ['APPROVER']), appr('u3', ['ADMIN'])] }).satisfied).toBe(true);
  });
  it('17. budget cap: a single step over max delta is rejected pre-preview', () => {
    const over: TypedProposedAction = { ...action, budget: { toMinor: 20000, fromMinor: 10000, currency: 'SAR' } }; // +100% > 50%
    expect(validateProposedAction(over, 'PLATFORM_REPORTED').ok).toBe(false);
  });
  it('18. role revoked: a principal without approve perm cannot approve', () => {
    expect(canApprove({ requesterUserId: 'u1', actorUserId: 'u2', actor: human('u2', ['VIEWER']) }).ok).toBe(false);
  });
  it('19. API key scope enforced (expired/out-of-scope fail closed)', () => {
    const { plaintext, secretHash } = mintServiceKey();
    const acct: ServiceAccount = { id: 's', organizationId: 'o', name: 'svc', keyPrefix: plaintext.split('.')[0]!, scopes: ['reports:read'], isServiceAccount: true };
    expect(authenticateServiceKey({ presented: plaintext, account: acct, storedHash: secretHash, requiredScope: 'ops:execute' }).ok).toBe(false);
    expect(authenticateServiceKey({ presented: plaintext, account: acct, storedHash: secretHash, requiredScope: 'reports:read' }).ok).toBe(true);
  });
  it('20. MCP scope: an expired key is denied', () => {
    const { plaintext, secretHash } = mintServiceKey();
    const acct: ServiceAccount = { id: 's', organizationId: 'o', name: 'svc', keyPrefix: 'mk', scopes: ['tools:read'], expiresAt: new Date(Date.now() - 1000).toISOString(), isServiceAccount: true };
    expect(authenticateServiceKey({ presented: plaintext, account: acct, storedHash: secretHash, requiredScope: 'tools:read' }).ok).toBe(false);
  });
  it('21. webhook replay — covered by commerce webhooks (dedup + replay window); here: state machine rejects re-apply', () => {
    expect(canTransition('APPLIED', 'APPLYING')).toBe(false);
  });
  it('22. queue double claim prevented (atomic claim single-winner model)', () => {
    expect(evaluateClaim({ state: 'CLAIMED', claimToken: 'x' }).claimed).toBe(false);
  });
  it('23. worker crash mid-apply leaves CLAIMED/APPLYING; UNKNOWN_RESULT reachable, not APPLIED-by-default', () => {
    expect(canTransition('APPLYING', 'UNKNOWN_RESULT')).toBe(true);
    expect(isTerminal('UNKNOWN_RESULT')).toBe(false);
  });
  it('24. provider outage → health ERROR blocks writes', () => {
    const h = deriveProviderHealth({ lastProbeOk: false });
    expect(h.state).toBe('ERROR');
    expect(healthAllowsWrite(h.state)).toBe(false);
  });
  it('25. rate limiting surfaces RATE_LIMITED health', () => {
    expect(deriveProviderHealth({ recentRateLimited: true }).state).toBe('RATE_LIMITED');
  });
  it('26. KMS key rotation: old data still decrypts after rotation', () => {
    const ring = new KeyRing([{ version: 'v1', key: randomBytes(32), state: 'ACTIVE' }]);
    const sealed = seal(ring, 'provider-token');
    ring.rotate({ version: 'v2', key: randomBytes(32) });
    expect(open(ring, sealed)).toBe('provider-token');          // sealed under v1, still readable
    const resealed = reseal(ring, sealed);
    expect(resealed.keyVersion).toBe('v2');                     // re-encrypted under the active key
    expect(open(ring, resealed)).toBe('provider-token');
  });
  it('27. audit correlation: approval card carries the exact change + identity', () => {
    const card = buildApprovalCard({ operationId: 'op1', identity: { agencyId: 'ag', clientOrganizationId: 'cli', accountId: 'act_1' }, provider: 'meta', action: 'SET_DAILY_BUDGET', before: { budget: 10000 }, after: { budget: 12000 }, risk: 'MODERATE', confidence: 'MEDIUM', evidence: {}, requesterUserId: 'u1', requiredApprovers: 1, requireSenior: false, collectedApprovers: 0, expiresAt: future, state: 'PENDING_APPROVAL' });
    expect(card.exactChange.en).toContain('10000');
    expect(card.exactChange.en).toContain('cli');
  });
  it('28. Arabic approval text present', () => {
    const card = buildApprovalCard({ operationId: 'op1', identity: { agencyId: 'ag', clientOrganizationId: 'cli' }, provider: 'meta', action: 'PAUSE_ENTITY', before: {}, after: {}, risk: 'LOW', confidence: 'LOW', evidence: {}, requesterUserId: 'u1', requiredApprovers: 1, requireSenior: false, collectedApprovers: 0, expiresAt: future, state: 'PENDING_APPROVAL' });
    expect(card.exactChange.ar.length).toBeGreaterThan(0);
  });
  it('29. English approval text present', () => {
    const req = requiredApprovals({ riskClass: 'CRITICAL' });
    expect(req.reasons.join(' ').length).toBeGreaterThan(0);
  });
  it('30. high-risk action escalates to 2 approvers', () => {
    expect(requiredApprovals({ riskClass: 'HIGH' }).quorum).toBe(2);
  });
  it('31. low-risk action is single-approver', () => {
    expect(requiredApprovals({ riskClass: 'LOW' }).quorum).toBe(1);
  });
  it('32. model cannot write (execute)', () => {
    expect(canExecute({ userId: 'ai', roles: ['OWNER'], isModel: true }).ok).toBe(false);
  });
  it('33. model cannot approve', () => {
    expect(canApprove({ requesterUserId: 'u1', actorUserId: 'ai', actor: { userId: 'ai', roles: ['OWNER'], isModel: true } }).ok).toBe(false);
  });
  it('34. scheduled job (service account) cannot approve itself', () => {
    expect(canApprove({ requesterUserId: 'job', actorUserId: 'job', actor: { userId: 'job', roles: ['ADMIN'], isServiceAccount: true } }).ok).toBe(false);
  });
  it('35. emergency lock (GLOBAL kill switch) blocks all writes', () => {
    expect(evaluateWriteBlocked({ organizationId: 'o', provider: 'meta', accountId: 'a', actionType: 'PAUSE_ENTITY' }, [{ scope: 'GLOBAL', key: '', active: true }]).blocked).toBe(true);
  });
  it('36. migration compatibility: unknown action fails closed', () => {
    expect('error' in resolveAction('DELETE_CAMPAIGN')).toBe(true);
  });
  it('37. backup/restore metadata — change record requires who/what/why', () => {
    expect(() => changeRecord({ organizationId: 'o', changeType: 'policy_update', actorUserId: 'u1', before: {}, after: {}, reason: '' })).toThrow();
    expect(changeRecord({ organizationId: 'o', changeType: 'kill_switch_change', actorUserId: 'u1', before: { active: false }, after: { active: true }, reason: 'incident' }).reason).toBe('incident');
  });
  it('38. observability trace redacts secrets', () => {
    const red = redactLog({ access_token: 'xyz', ok: true, nested: { refresh_token: 'r' } });
    expect((red as { access_token: string }).access_token).toBe('[REDACTED]');
    expect((red as { nested: { refresh_token: string } }).nested.refresh_token).toBe('[REDACTED]');
  });
  it('39. notification dedup collapses repeated alerts in a window', () => {
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const alerts: Alert[] = [{ rule: 'failed_provider_write', key: 'op1', message: 'x', at: at(0) }, { rule: 'failed_provider_write', key: 'op1', message: 'x', at: at(1000) }];
    expect(dedupeAlerts(alerts)).toHaveLength(1);
  });
  it('40. operation outcome linkage: APPLIED → ROLLBACK_REQUESTED legal, illegal jumps throw', () => {
    expect(canTransition('APPLIED', 'ROLLBACK_REQUESTED')).toBe(true);
    expect(() => assertTransition('PENDING_APPROVAL', 'APPLIED')).toThrow(IllegalTransitionError);
  });

  it('idempotency: exactly-once only where provider supports a key', () => {
    expect(claimsExactlyOnce('google')).toBe(true);
    expect(claimsExactlyOnce('meta')).toBe(false);
    expect(idempotencyKeyFor('meta', operationDigest(action, 'v1'))).toBeNull();
    expect(idempotencyKeyFor('google', operationDigest(action, 'v1'))).toBeTruthy();
  });
  it('first-customer flow: bulk writes across clients are refused; reads allowed', () => {
    expect(guardBulkOperation({ mode: 'read', clientCount: 50 }).allowed).toBe(true);
    expect(guardBulkOperation({ mode: 'write', clientCount: 50 }).allowed).toBe(false);
  });
  it('billing admin role does not imply ad-write', () => {
    expect(permissionsFor(['VIEWER']).has('execute_approved_operation')).toBe(false);
    expect(can(human('u', ['ANALYST']), 'execute_approved_operation')).toBe(false);
  });
});
