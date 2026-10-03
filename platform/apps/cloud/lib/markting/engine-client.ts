/**
 * HTTP client for the paid-media-agent host (services/engine-demo/serve_demo.py).
 *
 * Deliberately has no `approve` or `edit` method: the engine must never be driven to execute a
 * write from adport. A test asserts that neither path is ever requested.
 *
 * Pure module (no server-only import) so tests can construct it with a stubbed `fetch`.
 */

export interface EngineOutcome {
  version: string;
  thread_id: string;
  text: string;
  interrupted: boolean;
  proposal: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  available_actions: string[];
}

export interface EngineHealth {
  status: string;
  persistence: string;
  catalog_revision: string;
  catalog_source: string;
  selection: string;
  writes_enabled: boolean;
}

export interface EngineReportFile { path: string; media_type: string; byte_size: number }
export interface EngineReportRun {
  id: string;
  cadence: 'weekly' | 'monthly';
  end: string;
  current_window: { start: string; end: string };
  previous_window: { start: string; end: string };
  created_at: string;
  requested_by: string;
  reconciled: boolean;
  analysis_artifact_id: string;
  payload_artifact_id: string | null;
  files: EngineReportFile[];
  pdf: string | null;
  unavailable: string[];
  summary: Record<string, unknown>;
}

export class EngineError extends Error {
  constructor(message: string, readonly status: number, readonly code: 'unreachable' | 'unauthorized' | 'conflict' | 'not_found' | 'upstream' | 'invalid') {
    super(message);
    this.name = 'EngineError';
  }
}

export interface EngineClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const FORBIDDEN_PATHS = [/\/proposals\/[^/]+\/approve$/, /\/proposals\/[^/]+\/edit$/];

export class EngineClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: EngineClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 240_000;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, raw = false, organization?: string): Promise<T> {
    if (FORBIDDEN_PATHS.some((pattern) => pattern.test(path))) {
      throw new EngineError('The adport bridge never approves or edits engine proposals.', 403, 'invalid');
    }
    if (!this.token && path !== '/health') throw new EngineError('MARKTING_ENGINE_TOKEN is not configured.', 503, 'unauthorized');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          // Tenant identity for the engine's per-org report scoping (R0-07). The engine fails closed
          // without it on the report surface.
          ...(organization ? { 'x-markting-org': organization } : {}),
          accept: raw ? '*/*' : 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      throw new EngineError(`Engine unreachable: ${error instanceof Error ? error.name : 'error'}`, 503, 'unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const code = response.status === 401 || response.status === 503 ? 'unauthorized'
        : response.status === 409 ? 'conflict'
          : response.status === 404 ? 'not_found' : 'upstream';
      throw new EngineError(`Engine returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`, response.status, code);
    }
    return (raw ? response : response.json()) as Promise<T>;
  }

  health(): Promise<EngineHealth> { return this.request('GET', '/health'); }

  /** One synchronous chat turn. Can take minutes with a live model; the host route must allow it. */
  sendMessage(threadId: string, text: string): Promise<EngineOutcome> {
    return this.request('POST', `/threads/${encodeURIComponent(threadId)}/messages`, { text });
  }

  getProposal(proposalId: string): Promise<{ proposal: Record<string, unknown>; receipt: Record<string, unknown> | null }> {
    return this.request('GET', `/proposals/${encodeURIComponent(proposalId)}`);
  }

  /** Tell the engine adport took over, so its graph resumes. Never "approve". */
  rejectProposal(proposalId: string, message: string): Promise<EngineOutcome> {
    return this.request('POST', `/proposals/${encodeURIComponent(proposalId)}/reject`, { message: message.slice(0, 500) });
  }

  runReport(organization: string, cadence: 'weekly' | 'monthly', end?: string): Promise<EngineReportRun> {
    return this.request('POST', '/reports/run', { cadence, ...(end ? { end } : {}) }, false, organization);
  }

  listReports(organization: string): Promise<{ reports: EngineReportRun[] }> { return this.request('GET', '/reports', undefined, false, organization); }

  /** Raw file response (HTML/PDF/JSON); the caller streams it to the browser as an attachment. */
  async fetchReportFile(organization: string, name: string): Promise<Response> {
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(name) || name.startsWith('.')) throw new EngineError('Invalid report file name.', 400, 'invalid');
    return this.request('GET', `/reports/files/${encodeURIComponent(name)}`, undefined, true, organization);
  }
}
