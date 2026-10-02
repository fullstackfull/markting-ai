import { sessionPrincipal } from '@/lib/cloud/auth';
import { listPendingOperations, PostgresPendingStore, recordAudit } from '@/lib/cloud/repository';
import { apiError, HttpError, noStoreJson } from '@/lib/http';
import { markPendingOutcome } from '@/lib/markting/repository';

/** Reject a previewed operation: consume the pending row and write a `rejected` audit event. No provider call. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { organizationId?: string; reason?: string };
    const principal = await sessionPrincipal(body.organizationId);
    if (principal.role === 'viewer') throw new HttpError('Viewers cannot reject changes.', 403);
    const row = (await listPendingOperations(principal.organizationId, 200)).find((candidate) => candidate.id === id);
    if (!row) throw new HttpError('Pending operation not found, expired, or already applied.', 404);
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : '';
    await new PostgresPendingStore(principal).delete(row.id);
    await recordAudit(principal, {
      event: 'rejected', provider: row.provider, tool: row.operation.tool, accountId: row.operation.accountId, pendingId: row.id,
      summary: `Rejected in dashboard: ${row.preview?.summary ?? row.operation.tool}${reason ? ` — ${reason}` : ''}`.slice(0, 500),
    });
    await markPendingOutcome(principal.organizationId, row.id, 'rejected', reason || undefined);
    return noStoreJson({ ok: true });
  } catch (error) {
    return apiError(error instanceof Error && error.message === 'Authentication required.' ? new HttpError(error.message, 401) : error);
  }
}
