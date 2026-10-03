import { sessionPrincipal } from '@/lib/cloud/auth';
import { enforceRateLimit } from '@/lib/cloud/repository';
import { apiError, HttpError, noStoreJson } from '@/lib/http';
import { engineClient } from '@/lib/markting/assistant';
import { EngineError } from '@/lib/markting/engine-client';

export const maxDuration = 300;

function translate(error: unknown): unknown {
  if (error instanceof Error && error.message === 'Authentication required.') return new HttpError(error.message, 401);
  if (error instanceof EngineError) return new HttpError(error.code === 'unreachable' ? 'The analysis engine is not reachable right now.' : error.message, error.status >= 500 ? 503 : error.status);
  return error;
}

/** List engine report runs (server-side call; the engine token never reaches the browser). */
export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId') ?? undefined;
    const principal = await sessionPrincipal(organizationId);
    return noStoreJson(await engineClient().listReports(principal.organizationId));
  } catch (error) {
    return apiError(translate(error));
  }
}

/** Trigger a deterministic weekly/monthly report on the engine. Read-only on ad platforms. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { organizationId?: string; cadence?: string; end?: string };
    const principal = await sessionPrincipal(body.organizationId);
    if (principal.role === 'viewer') throw new HttpError('Viewers cannot run reports.', 403);
    if (!(await enforceRateLimit(`markting:reports:${principal.organizationId}`))) throw new HttpError('Rate limit exceeded.', 429);
    const cadence = body.cadence === 'monthly' ? 'monthly' : 'weekly';
    const end = typeof body.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.end) ? body.end : undefined;
    return noStoreJson(await engineClient().runReport(principal.organizationId, cadence, end));
  } catch (error) {
    return apiError(translate(error));
  }
}
