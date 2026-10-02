import { sessionPrincipal, requireScope } from '@/lib/cloud/auth';
import { listPendingOperations } from '@/lib/cloud/repository';
import { apiError, HttpError, noStoreJson } from '@/lib/http';
import { applyPending } from '@/lib/markting/bridge';
import { marktingEnv } from '@/lib/markting/env';
import { markPendingOutcome } from '@/lib/markting/repository';
import { createBridgeRuntime } from '@/lib/markting/runtime';

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
    const row = (await listPendingOperations(principal.organizationId, 200)).find((candidate) => candidate.id === id);
    if (!row) throw new HttpError('Pending operation not found, expired, or already applied.', 404);
    if (row.createdBy && row.createdBy === principal.userId && marktingEnv().MARKTING_ALLOW_SELF_APPROVAL !== 'true') {
      throw new HttpError('The person who requested a change cannot approve it (set MARKTING_ALLOW_SELF_APPROVAL=true for single-user demos).', 403);
    }
    const runtime = await createBridgeRuntime(principal);
    const result = await applyPending(runtime, { id: row.id, operation: row.operation as { tool: string; accountId: string; payload: Record<string, unknown> } });
    await markPendingOutcome(principal.organizationId, row.id, 'applied');
    return noStoreJson({ ok: true, result });
  } catch (error) {
    return apiError(error instanceof Error && error.message === 'Authentication required.' ? new HttpError(error.message, 401) : error);
  }
}
