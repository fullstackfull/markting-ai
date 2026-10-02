import { sessionPrincipal } from '@/lib/cloud/auth';
import { apiError, HttpError } from '@/lib/http';
import { engineClient } from '@/lib/markting/assistant';
import { EngineError } from '@/lib/markting/engine-client';

/**
 * Stream one engine report file (HTML, PDF or JSON) to the signed-in user as an attachment.
 * Never rendered inline on the dashboard origin: the report body contains model-written prose.
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const organizationId = new URL(request.url).searchParams.get('organizationId') ?? undefined;
    await sessionPrincipal(organizationId);
    const upstream = await engineClient().fetchReportFile(name);
    const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!/^(text\/html|application\/pdf|application\/json)/.test(type)) throw new HttpError('Unexpected report file type.', 502);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': type,
        'content-disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9_.-]/g, '')}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required.') return apiError(new HttpError(error.message, 401));
    if (error instanceof EngineError) return apiError(new HttpError(error.code === 'not_found' ? 'Report file not found.' : error.message, error.status >= 500 ? 503 : error.status));
    return apiError(error);
  }
}
