import 'server-only';
import { createContext, PolicyEngine, type AdportRuntime } from '@adport/core';
import { createTenantRuntime } from '@/lib/cloud/runtime';
import { getOrganizationPolicy, PostgresAuditStore, PostgresFindingsStore, PostgresPendingStore } from '@/lib/cloud/repository';
import type { TenantPrincipal } from '@/lib/cloud/types';
import { isDemoMode } from './env';
import { PostgresSandboxStore } from './repository';
import { SandboxProvider, sandboxTools } from './sandbox-provider';

/**
 * The runtime the bridge previews and applies through.
 *
 * Live mode: the upstream tenant runtime (encrypted provider credentials, account scope).
 * Demo mode: the credential-free sandbox provider, but the SAME PolicyEngine wired to the same
 * Postgres pending/audit stores, so demo previews appear on the Approvals page and in the audit
 * log exactly like real ones. The upstream `/mcp` and `/api/v1` routes never use this function.
 */
export async function createBridgeRuntime(principal: TenantPrincipal): Promise<AdportRuntime> {
  if (!isDemoMode()) return createTenantRuntime(principal);
  const policy = await getOrganizationPolicy(principal.organizationId);
  const provider = new SandboxProvider(new PostgresSandboxStore(principal.organizationId));
  return createContext({
    providerModules: [{ provider, tools: sandboxTools(provider) }],
    engine: new PolicyEngine(policy, new PostgresPendingStore(principal), new PostgresAuditStore(principal)),
    findings: new PostgresFindingsStore(principal.organizationId),
  });
}
