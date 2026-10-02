import { NextResponse } from 'next/server';
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n/config';

/** Persist the UI language in a cookie. No authentication needed: it only affects presentation. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { locale?: unknown };
  if (!isLocale(body.locale)) return NextResponse.json({ error: 'Unsupported locale.' }, { status: 400 });
  const response = NextResponse.json({ locale: body.locale }, { headers: { 'cache-control': 'no-store' } });
  response.cookies.set(LOCALE_COOKIE, body.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false });
  return response;
}
