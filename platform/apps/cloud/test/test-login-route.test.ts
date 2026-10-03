import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/test/login/route';

/**
 * CODE-RC Program 1 — the test-only login route is a hard 404 unless MARKTING_E2E_TEST_AUTH=1, and even
 * when enabled it rejects non-seeded emails and a missing test password. This proves it cannot become a
 * production auth bypass: remove the flag and it does not exist.
 */
afterEach(() => {
  delete process.env.MARKTING_E2E_TEST_AUTH;
  delete process.env.MARKTING_E2E_TEST_PASSWORD;
});

const req = (qs = '') => new Request(`http://127.0.0.1:3100/api/test/login${qs}`);

describe('test-only login route gating', () => {
  it('is 404 when the flag is not set (production posture)', async () => {
    delete process.env.MARKTING_E2E_TEST_AUTH;
    const res = await GET(req('?email=buyer@e2e.test'));
    expect(res.status).toBe(404);
  });

  it('rejects a non-seeded email even when enabled', async () => {
    process.env.MARKTING_E2E_TEST_AUTH = '1';
    process.env.MARKTING_E2E_TEST_PASSWORD = 'test-password-abcdef';
    const res = await GET(req('?email=attacker@evil.test'));
    expect(res.status).toBe(400);
  });

  it('rejects when no test password is configured even for a seeded email', async () => {
    process.env.MARKTING_E2E_TEST_AUTH = '1';
    delete process.env.MARKTING_E2E_TEST_PASSWORD;
    const res = await GET(req('?email=buyer@e2e.test'));
    expect(res.status).toBe(400);
  });
});
