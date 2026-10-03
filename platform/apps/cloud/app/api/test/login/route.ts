import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeReturnPath } from '@/lib/return-path';

/**
 * TEST-ONLY authenticated-session bootstrap for deterministic browser E2E (CODE-RC Program 1).
 *
 * This route is a hard 404 unless `MARKTING_E2E_TEST_AUTH === '1'` — a flag that is NEVER set in
 * production. It is NOT an auth bypass: it performs a REAL Supabase `signInWithPassword` for a seeded
 * test user (created by the e2e seed with a known password), so the SSR client issues genuine,
 * correctly-formatted session cookies. There is no `if (email === 'test')` shortcut and no JWT forgery
 * — remove the flag and the mechanism does not exist. Only a short allowlist of seeded test emails is
 * accepted, so even with the flag on it cannot sign in an arbitrary account.
 */
const SEEDED_EMAILS = new Set([
  'buyer@e2e.test',
  'agencyadmin@e2e.test',
  'viewer@e2e.test',
]);

export async function GET(request: Request): Promise<Response> {
  if (process.env.MARKTING_E2E_TEST_AUTH !== '1') {
    return new NextResponse('Not found', { status: 404 });
  }
  const url = new URL(request.url);
  const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
  const password = process.env.MARKTING_E2E_TEST_PASSWORD ?? '';
  if (!SEEDED_EMAILS.has(email) || password.length < 12) {
    return new NextResponse('test login requires a seeded email and a configured test password', { status: 400 });
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return new NextResponse(`test login failed: ${error.message}`, { status: 401 });
  }
  const next = safeReturnPath(url.searchParams.get('next'));
  return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
}
