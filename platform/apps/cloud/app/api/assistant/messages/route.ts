import { sessionPrincipal } from '@/lib/cloud/auth';
import { enforceRateLimit } from '@/lib/cloud/repository';
import { apiError, HttpError, noStoreJson } from '@/lib/http';
import { runAssistantTurn } from '@/lib/markting/assistant';

// A live model turn can take minutes; keep the route on the Node runtime with a long budget.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { organizationId?: string; threadId?: string; text?: string };
    const principal = await sessionPrincipal(body.organizationId);
    if (!(await enforceRateLimit(`markting:assistant:${principal.organizationId}:${principal.userId}`))) throw new HttpError('Rate limit exceeded.', 429);
    if (typeof body.text !== 'string') throw new HttpError('text is required.', 400);
    return noStoreJson(await runAssistantTurn(principal, { threadId: body.threadId, text: body.text }));
  } catch (error) {
    return apiError(error instanceof Error && error.message === 'Authentication required.' ? new HttpError(error.message, 401) : error);
  }
}
