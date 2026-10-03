import 'server-only';
import {
  AdportError,
  type AdProvider,
  type NormalizedQuery,
  type WriteGuard,
  type WriteOperation,
} from '@adport/core';
import { assertWriteNotKilled } from './store';

/**
 * WAVE 0 — enforce the production KILL SWITCH on the real provider-apply path (closes GAP-SEC-01).
 *
 * A transparent decorator over any {@link AdProvider} that evaluates the cluster-safe kill-switch
 * state (GLOBAL / ORGANIZATION / PROVIDER / ACCOUNT / ACTION_TYPE) **server-side, immediately before a
 * provider mutation** and FAILS CLOSED. Reads (`report`, `listAccounts`) and previews
 * (`previewWrite`) pass through unchanged — a kill switch stops NEW writes, not analysis, and a
 * preview performs no provider mutation. The actual mutation (`applyWrite`) is blocked.
 *
 * This wraps BOTH the live account-scoped providers (createTenantRuntime) and the demo sandbox
 * provider (createBridgeRuntime), so every write surface — the dashboard apply route, REST, and MCP —
 * inherits the guard through the one shared runtime, and it is exercisable in CI via the sandbox
 * (no live provider credentials required). The guard is independent of the UI and of runtime mode.
 */
export class KillGuardedProvider implements AdProvider {
  readonly id: string;

  constructor(private readonly inner: AdProvider, private readonly organizationId: string) {
    this.id = inner.id;
  }

  capabilities() { return this.inner.capabilities(); }

  listAccounts() { return this.inner.listAccounts(); }

  report(query: NormalizedQuery) { return this.inner.report(query); }

  previewWrite(op: WriteOperation, guard: WriteGuard) { return this.inner.previewWrite(op, guard); }

  async applyWrite(op: WriteOperation, guard: WriteGuard) {
    const decision = await assertWriteNotKilled(this.organizationId, {
      organizationId: this.organizationId,
      provider: op.provider ?? this.id,
      accountId: op.accountId,
      actionType: op.kind,
    });
    if (!decision.allowed) {
      throw new AdportError(
        'POLICY_VIOLATION',
        decision.reason ?? 'Provider writes are halted by an active kill switch.',
        { provider: this.id, accountId: op.accountId },
      );
    }
    return this.inner.applyWrite(op, guard);
  }

  standardActions() { return this.inner.standardActions?.() ?? {}; }
}
