/**
 * Phase 7H — AGENCY MULTI-CLIENT model. Agency → Client Organization → Workspace → Ad Accounts /
 * Stores → Users. Agency staff may have SCOPED access to multiple clients, but EVERY query/action must
 * resolve the tenant/client scope explicitly from the server-side membership graph — never from a
 * client payload — so there is no cross-client leakage. Write previews must prominently show the exact
 * agency / client-org / workspace / account identity to prevent acting on the wrong client.
 */

export interface AgencyScope {
  agencyId: string;
  clientOrganizationId: string;
  workspaceId?: string;
  accountId?: string;
}

export interface AgencyMembership {
  userId: string;
  agencyId: string;
  /** The client organizations this user is explicitly granted, server-side. */
  clientOrganizationIds: string[];
  role: string;
  /** Optional server graph: which workspaces/accounts belong under each client org. When present, a
   * requested workspace/account is validated to belong under the requested client (prevents a user
   * granted client-A from targeting a workspace/account that belongs to client-B). */
  scopeGraph?: Record<string, { workspaces?: string[]; accounts?: string[] }>;
}

/** Resolve whether a user may act within a requested client scope, from the server membership graph. */
export function resolveClientScope(membership: AgencyMembership, requested: AgencyScope): { allowed: boolean; reason?: string } {
  if (membership.agencyId !== requested.agencyId) return { allowed: false, reason: 'agency mismatch' };
  if (!membership.clientOrganizationIds.includes(requested.clientOrganizationId)) {
    return { allowed: false, reason: `user is not granted client ${requested.clientOrganizationId}` };
  }
  // Validate the sub-scope belongs under the requested client (when the server graph is provided).
  const graph = membership.scopeGraph?.[requested.clientOrganizationId];
  if (graph) {
    if (requested.workspaceId && graph.workspaces && !graph.workspaces.includes(requested.workspaceId)) {
      return { allowed: false, reason: `workspace ${requested.workspaceId} does not belong to client ${requested.clientOrganizationId}` };
    }
    if (requested.accountId && graph.accounts && !graph.accounts.includes(requested.accountId)) {
      return { allowed: false, reason: `account ${requested.accountId} does not belong to client ${requested.clientOrganizationId}` };
    }
  }
  return { allowed: true };
}

/** A write preview's identity banner — shown prominently so an approver cannot act on the wrong client. */
export interface ClientIdentityBanner { agencyId: string; clientOrganizationId: string; workspaceId?: string; accountId?: string; provider?: string }

export function identityBanner(scope: AgencyScope, provider?: string): ClientIdentityBanner {
  return { agencyId: scope.agencyId, clientOrganizationId: scope.clientOrganizationId, workspaceId: scope.workspaceId, accountId: scope.accountId, provider };
}

/**
 * Guard a bulk operation across many clients. Read-only bulk views are allowed; BULK WRITES across
 * client accounts are refused in Phase 7 (they need separate future governance).
 */
export function guardBulkOperation(input: { mode: 'read' | 'write'; clientCount: number }): { allowed: boolean; reason?: string } {
  if (input.mode === 'read') return { allowed: true };
  return { allowed: false, reason: 'one-click bulk writes across client accounts are not enabled in Phase 7 (require separate future governance)' };
}
