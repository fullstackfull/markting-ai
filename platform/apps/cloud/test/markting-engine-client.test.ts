import { describe, expect, it, vi } from 'vitest';
import { EngineClient, EngineError } from '@/lib/markting/engine-client';

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('EngineClient', () => {
  it('sends the bearer token server-side and parses an outcome', async () => {
    const { impl, calls } = stubFetch(() => new Response(JSON.stringify({ version: 'presentation/1', thread_id: 't', text: 'hi', interrupted: false, proposal: null, receipt: null, available_actions: [] }), { status: 200 }));
    const client = new EngineClient({ baseUrl: 'http://engine:8080/', token: 'secret-token-123', fetchImpl: impl });
    const outcome = await client.sendMessage('org_x__u_y__abc', 'hello');
    expect(outcome.text).toBe('hi');
    expect(calls[0]!.url).toBe('http://engine:8080/threads/org_x__u_y__abc/messages');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer secret-token-123');
    expect(calls[0]!.init.body).toBe(JSON.stringify({ text: 'hello' }));
  });

  it('has no approve or edit path and refuses them even if constructed by hand', async () => {
    const { impl, calls } = stubFetch(() => new Response('{}', { status: 200 }));
    const client = new EngineClient({ baseUrl: 'http://engine:8080', token: 'secret-token-123', fetchImpl: impl });
    expect((client as unknown as Record<string, unknown>).approveProposal).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).editProposal).toBeUndefined();
    const request = (client as unknown as { request: (m: string, p: string) => Promise<unknown> }).request.bind(client);
    await expect(request('POST', '/proposals/abc/approve')).rejects.toBeInstanceOf(EngineError);
    await expect(request('POST', '/proposals/abc/edit')).rejects.toBeInstanceOf(EngineError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a proposal with a capped message', async () => {
    const { impl, calls } = stubFetch(() => new Response(JSON.stringify({ version: 'presentation/1', thread_id: 't', text: 'ok', interrupted: false, proposal: { state: 'rejected' }, receipt: null, available_actions: [] }), { status: 200 }));
    const client = new EngineClient({ baseUrl: 'http://engine:8080', token: 'secret-token-123', fetchImpl: impl });
    await client.rejectProposal('9c7d5308-7c4a-47d7-8222-5529eed7dffe', 'x'.repeat(900));
    expect(calls[0]!.url).toMatch(/\/proposals\/9c7d5308-7c4a-47d7-8222-5529eed7dffe\/reject$/);
    expect(JSON.parse(calls[0]!.init.body as string).message).toHaveLength(500);
  });

  it('maps upstream failures to typed errors', async () => {
    const codes: Array<[number, string]> = [[401, 'unauthorized'], [404, 'not_found'], [409, 'conflict'], [500, 'upstream'], [503, 'unauthorized']];
    for (const [status, code] of codes) {
      const { impl } = stubFetch(() => new Response('nope', { status }));
      const client = new EngineClient({ baseUrl: 'http://engine:8080', token: 'secret-token-123', fetchImpl: impl });
      await expect(client.listReports('org-1')).rejects.toMatchObject({ status, code });
    }
    const { impl } = stubFetch(() => { throw new TypeError('fetch failed'); });
    await expect(new EngineClient({ baseUrl: 'http://engine:8080', token: 'secret-token-123', fetchImpl: impl }).health()).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('refuses authenticated calls without a token and validates report file names', async () => {
    const { impl, calls } = stubFetch(() => new Response('{}', { status: 200 }));
    const client = new EngineClient({ baseUrl: 'http://engine:8080', fetchImpl: impl });
    await expect(client.listReports('org-1')).rejects.toMatchObject({ code: 'unauthorized' });
    const withToken = new EngineClient({ baseUrl: 'http://engine:8080', token: 'secret-token-123', fetchImpl: impl });
    for (const name of ['../x.html', '.hidden', 'a/b.pdf', 'name with spaces.html', '']) {
      await expect(withToken.fetchReportFile('org-1', name)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(calls).toHaveLength(0);
    await withToken.fetchReportFile('org-1', 'rpt_4f13815d2f40.pdf');
    expect(calls[0]!.url).toBe('http://engine:8080/reports/files/rpt_4f13815d2f40.pdf');
    // The tenant identity must travel to the engine so its report surface can scope per-org (SEC-01).
    expect((calls[0]!.init.headers as Record<string, string>)['x-markting-org']).toBe('org-1');
  });
});
