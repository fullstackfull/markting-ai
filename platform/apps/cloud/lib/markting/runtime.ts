import 'server-only';
import { createContext, PolicyEngine, type AdportRuntime } from '@adport/core';
import { createTenantRuntime, principalToActor } from '@/lib/cloud/runtime';
import { getOrganizationPolicy, PostgresAuditStore, PostgresFindingsStore, PostgresPendingStore } from '@/lib/cloud/repository';
import type { TenantPrincipal } from '@/lib/cloud/types';
import { isDemoMode, marktingEnv } from './env';
import { PostgresSandboxStore } from './repository';
import { SandboxProvider, sandboxTools } from './sandbox-provider';
import { KillGuardedProvider } from './ops/kill-guarded-provider';

/**
 * The runtime the bridge previews and applies through.
 *
 * Live mode: the upstream tenant runtime (encrypted provider credentials, account scope).
 * Demo mode: the credential-free sandbox provider, but the SAME PolicyEngine wired to the same
 * Postgres pending/audit stores, so demo previews appear on the Approvals page and in the audit
 * log exactly like real ones. The upstream `/mcp` and `/api/v1` routes never use this function.
 */
export async function createBridgeRuntime(principal: TenantPrincipal): Promise<AdportRuntime> {
  const allowSelfApproval = marktingEnv().MARKTING_ALLOW_SELF_APPROVAL === 'true';
  if (!isDemoMode()) {
    const runtime = await createTenantRuntime(principal);
    // The dashboard apply path is a human approver; permit the configured self-approval exception.
    runtime.ctx.writeActor = principalToActor(principal);
    runtime.ctx.allowSelfApproval = allowSelfApproval;
    return runtime;
  }
  const policy = await getOrganizationPolicy(principal.organizationId);
  const sandbox = new SandboxProvider(new PostgresSandboxStore(principal.organizationId));
  // WAVE 0: the demo apply path honours the kill switch too, so the control is exercisable end-to-end
  // (and in CI) without live provider credentials (GAP-SEC-01). sandboxTools call through the same
  // provider instance, so the guard sits on the one apply seam.
  const provider = new KillGuardedProvider(sandbox, principal.organizationId);
  return createContext({
    providerModules: [{ provider, tools: sandboxTools(sandbox) }],
    engine: new PolicyEngine(policy, new PostgresPendingStore(principal), new PostgresAuditStore(principal)),
    findings: new PostgresFindingsStore(principal.organizationId),
    writeActor: principalToActor(principal),
    allowSelfApproval,
  });
}
