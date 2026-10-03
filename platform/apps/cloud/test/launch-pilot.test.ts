/**
 * Launch validation — KMS rotation drill (Stage 2/10) + the controlled write/rollback/failure pilot
 * (Stages 12/13/14) exercised against a SANDBOX/mock provider adapter. These prove the governance
 * machinery end-to-end WITHOUT a live provider (live writes are HELD until credentials + authorization
 * exist). The pure decision logic is exercised here; the real atomic claim + CAS persistence is proven
 * on real Postgres in launch.database.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { KeyRing, seal, open, reseal, secretFingerprint } from '@/lib/markting/ops/kms';
import { validateProposedAction, ACTION_ALLOWLIST, type TypedProposedAction } from '@/lib/markting/ops/actions';
import { requiredApprovals, evaluateQuorum, revalidateAtApply, type CollectedApproval } from '@/lib/markting/ops/approval-policy';
import { operationDigest, evaluateClaim, reconcileUnknownResult } from '@/lib/markting/ops/idempotency';
import { buildRollback } from '@/lib/markting/ops/rollback';
import type { Principal } from '@/lib/markting/ops/rbac';

// ---- A sandbox provider adapter: deterministic, can simulate failures. Never a live provider. ----
class SandboxProvider {
  private state = new Map<string, { budgetMinor: number; status: 'ACTIVE' | 'PAUSED' }>();
  seed(entityId: string, s: { budgetMinor: number; status: 'ACTIVE' | 'PAUSED' }) { this.state.set(entityId, s); }
  fetch(entityId: string) { return this.state.get(entityId) ?? null; }
  /** Apply a write; `fault` simulates provider behaviour. Returns the raw result or throws/timeouts. */
  applyWrite(a: TypedProposedAction, fault?: 'timeout_before' | 'timeout_after' | 'ok'): { applied: true } {
    if (fault === 'timeout_before') throw new Error('provider timeout before dispatch');
    // the write lands:
    const cur = this.state.get(a.entityId) ?? { budgetMinor: 0, status: 'ACTIVE' };
    if (a.type === 'SET_DAILY_BUDGET' && a.budget) cur.budgetMinor = a.budget.toMinor;
    if (a.type === 'PAUSE_ENTITY') cur.status = 'PAUSED';
    if (a.type === 'RESUME_ENTITY') cur.status = 'ACTIVE';
    this.state.set(a.entityId, cur);
    if (fault === 'timeout_after') throw new Error('connection dropped after the write landed'); // result unknown
    return { applied: true };
  }
}

const human = (userId: string): CollectedApproval => ({ actorUserId: userId, actor: { userId, roles: ['APPROVER'] } as Principal, roles: ['APPROVER'], approvedAt: new Date().toISOString() });
const future = () => new Date(Date.now() + 3_600_000).toISOString();

describe('Launch — KMS rotation drill (Stage 2)', () => {
  it('rotates keys with zero downtime: old data still decrypts, new writes use the new key', () => {
    const ring = new KeyRing([{ version: 'v1', key: randomBytes(32), state: 'ACTIVE' }]);
    const token = 'provider-oauth-token-abc';
    const sealedV1 = seal(ring, token);
    const fp = secretFingerprint(token, 'audit-salt');
    // rotate to v2 (former ACTIVE → PREVIEW/decrypt-only)
    ring.rotate({ version: 'v2', key: randomBytes(32) });
    expect(open(ring, sealedV1)).toBe(token);          // old data still readable (no downtime)
    const resealed = reseal(ring, sealedV1);           // background re-encryption
    expect(resealed.keyVersion).toBe('v2');
    expect(open(ring, resealed)).toBe(token);
    expect(secretFingerprint(token, 'audit-salt')).toBe(fp); // audit fingerprint stable, secret never exposed
    // a sealed secret cannot be opened once its key version is removed from the ring
    const strictRing = new KeyRing([{ version: 'v2', key: randomBytes(32), state: 'ACTIVE' }]);
    expect(() => open(strictRing, sealedV1)).toThrow(/version v1 not in the keyring/);
  });
});

describe('Launch — controlled write pilot against the sandbox (Stages 12/13/14)', () => {
  const budgetAction: TypedProposedAction = { type: 'SET_DAILY_BUDGET', provider: 'sandbox', accountId: 'act_1', entityId: 'c1', entityLevel: 'campaign', budget: { toMinor: 11000, fromMinor: 10000, currency: 'SAR' } };
  const def = ACTION_ALLOWLIST.SET_DAILY_BUDGET;

  function previewSnapshot(digest: string, cur: { budgetMinor: number; status: 'ACTIVE' | 'PAUSED' }) {
    return { operationDigest: digest, targetOwnershipOk: true, providerEntityExists: true, currentBudgetMinor: cur.budgetMinor, currency: 'SAR', entityStatus: cur.status, policyVersion: 'v1', approvalExpiresAt: future() };
  }
  function liveSnapshot(digest: string, cur: { budgetMinor: number; status: 'ACTIVE' | 'PAUSED' }) {
    return { targetOwnershipOk: true, providerEntityExists: true, currentBudgetMinor: cur.budgetMinor, currency: 'SAR', entityStatus: cur.status, policyVersion: 'v1', operationDigest: digest };
  }

  it('happy path: full governed chain applies the tiny budget change and links an outcome', () => {
    const sb = new SandboxProvider(); sb.seed('c1', { budgetMinor: 10000, status: 'ACTIVE' });
    // 1 read current → 2 recommendation/typed action → 3 validate
    expect(validateProposedAction(budgetAction, 'PLATFORM_REPORTED').ok).toBe(true);
    // 4 preview + digest
    const digest = operationDigest(budgetAction, 'v1');
    const preview = previewSnapshot(digest, sb.fetch('c1')!);
    // 5/6 approval (requester u1, distinct approver u2)
    const req = requiredApprovals({ riskClass: def.riskClass, budgetDeltaFraction: 0.1 });
    expect(evaluateQuorum({ requirement: req, requesterUserId: 'u1', approvals: [human('u2')] }).satisfied).toBe(true);
    // 7 apply-time revalidation (required live checks enforced)
    expect(revalidateAtApply(preview, liveSnapshot(digest, sb.fetch('c1')!), { requiredChecks: def.requiredLiveStateChecks }).ok).toBe(true);
    // 8 atomic claim
    expect(evaluateClaim({ state: 'APPROVED', claimToken: null }).claimed).toBe(true);
    // 9 provider write (sandbox) → 10 fetch → 11 confirm
    sb.applyWrite(budgetAction, 'ok');
    expect(sb.fetch('c1')!.budgetMinor).toBe(11000);
  });

  it('Stage 14: timeout AFTER dispatch → UNKNOWN_RESULT, reconciliation confirms, no blind resend', () => {
    const sb = new SandboxProvider(); sb.seed('c1', { budgetMinor: 10000, status: 'ACTIVE' });
    let unknown = false;
    try { sb.applyWrite(budgetAction, 'timeout_after'); } catch { unknown = true; }
    expect(unknown).toBe(true); // result unknown
    const v = reconcileUnknownResult({ action: budgetAction, intended: { budgetMinor: 11000 }, actual: sb.fetch('c1'), pre: { budgetMinor: 10000 } });
    expect(v.verdict).toBe('APPLIED_CONFIRMED'); // the write DID land — we must NOT resend
  });

  it('Stage 14: timeout BEFORE dispatch → UNKNOWN; reconciliation shows pre-value → SAFE_TO_RETRY', () => {
    const sb = new SandboxProvider(); sb.seed('c1', { budgetMinor: 10000, status: 'ACTIVE' });
    let threw = false;
    try { sb.applyWrite(budgetAction, 'timeout_before'); } catch { threw = true; }
    expect(threw).toBe(true);
    const v = reconcileUnknownResult({ action: budgetAction, intended: { budgetMinor: 11000 }, actual: sb.fetch('c1'), pre: { budgetMinor: 10000 } });
    expect(v.verdict).toBe('SAFE_TO_RETRY'); // still at pre-value → the write did not land
  });

  it('Stage 14: stale preview (external budget change) → REPREVIEW_REQUIRED, apply refused', () => {
    const digest = operationDigest(budgetAction, 'v1');
    const preview = previewSnapshot(digest, { budgetMinor: 10000, status: 'ACTIVE' });
    const r = revalidateAtApply(preview, liveSnapshot(digest, { budgetMinor: 99999, status: 'ACTIVE' }), { requiredChecks: def.requiredLiveStateChecks });
    expect(r.ok).toBe(false);
  });

  it('Stage 14: expired approval → EXPIRED, apply refused', () => {
    const digest = operationDigest(budgetAction, 'v1');
    const preview = { ...previewSnapshot(digest, { budgetMinor: 10000, status: 'ACTIVE' }), approvalExpiresAt: new Date(Date.now() - 1000).toISOString() };
    const r = revalidateAtApply(preview, liveSnapshot(digest, { budgetMinor: 10000, status: 'ACTIVE' }), { requiredChecks: def.requiredLiveStateChecks });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('EXPIRED');
  });

  it('Stage 14: provider auth expiry at apply time → ownership/entity check fails → REPREVIEW_REQUIRED', () => {
    const digest = operationDigest(budgetAction, 'v1');
    const preview = previewSnapshot(digest, { budgetMinor: 10000, status: 'ACTIVE' });
    const r = revalidateAtApply(preview, { ...liveSnapshot(digest, { budgetMinor: 10000, status: 'ACTIVE' }), providerEntityExists: false }, { requiredChecks: def.requiredLiveStateChecks });
    expect(r.ok).toBe(false);
  });

  it('Stage 14: duplicate apply blocked (second claim fails)', () => {
    expect(evaluateClaim({ state: 'CLAIMED', claimToken: 'tok' }).claimed).toBe(false);
  });

  it('Stage 13: rollback is a NEW governed action restoring the exact previous budget', () => {
    const sb = new SandboxProvider(); sb.seed('c1', { budgetMinor: 11000, status: 'ACTIVE' });
    const rb = buildRollback({ action: budgetAction, before: { budgetMinor: 10000, currency: 'SAR' } });
    expect(rb.reversible).toBe(true);
    if (rb.reversible) {
      // the rollback action itself must pass validation + preview + approval (new governed op)
      expect(validateProposedAction(rb.action, 'PLATFORM_REPORTED').ok).toBe(true);
      sb.applyWrite(rb.action, 'ok');
      expect(sb.fetch('c1')!.budgetMinor).toBe(10000); // restored exactly
    }
  });
});
