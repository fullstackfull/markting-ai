import { sessionPrincipal, requireScope } from '@/lib/cloud/auth';
import { listPendingOperations } from '@/lib/cloud/repository';
import { apiError, HttpError, noStoreJson } from '@/lib/http';
import { applyPending } from '@/lib/markting/bridge';
import { markPendingOutcome } from '@/lib/markting/repository';
import { createBridgeRuntime } from '@/lib/markting/runtime';
import { assertApplyAllowed } from '@/lib/markting/runtime-mode';

/**
 * Apply a previewed operation from the dashboard. This is the exact "second call" of adport's
 * two-step contract, routed through the same registry and PolicyEngine as REST and MCP.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { organizationId?: string };
    const principal = await sessionPrincipal(body.organizationId);
    requireScope(principal, 'tools:write');
    if (principal.role === 'viewer' || principal.role === 'member') throw new HttpError('Only owners and admins can apply changes.', 403);
    // Fail closed on the runtime safety state: real provider writes stay disabled until the operator
    // explicitly opts up to LIVE_WRITE_APPROVAL_ONLY (gated behind the Phase 0 exit). DEMO applies to
    // the sandbox only. Phase 0 has no autonomous-write state at all (R0-12).
    assertApplyAllowed();
    const row = (await listPendingOperations(principal.organizationId, 200)).find((candidate) => candidate.id === id);
    if (!row) throw new HttpError('Pending operation not found, expired, or already applied.', 404);
    // Four-eyes (human approver, requester≠approver) is enforced in the single policy-engine seam
    // (createBridgeRuntime sets this session as the human approver), so every write surface — this
    // route, REST and MCP — inherits it. The engine also correctly handles API/engine-created
    // pendings that have no `created_by`, which the old route-level check silently exempted (SEC-26).
    const runtime = await createBridgeRuntime(principal);
    const result = await applyPending(runtime, { id: row.id, operation: row.operation as { tool: string; accountId: string; payload: Record<string, unknown> } });
    await markPendingOutcome(principal.organizationId, row.id, 'applied');
    return noStoreJson({ ok: true, result });
  } catch (error) {
    return apiError(error instanceof Error && error.message === 'Authentication required.' ? new HttpError(error.message, 401) : error);
  }
}
