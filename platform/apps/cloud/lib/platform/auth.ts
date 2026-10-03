import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/http';

/**
 * WAVE 1 — platform authorization. Authority comes ONLY from the platform_operators roster, never
 * from organization_membership. Every /admin route and every platform server action calls one of
 * these guards server-side; nav hiding is never the control.
 */
export const PLATFORM_ROLES = ['SUPER_ADMIN', 'PLATFORM_OPERATOR', 'SUPPORT_ADMIN', 'READ_ONLY_AUDITOR'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export interface PlatformOperator {
  userId: string;
  email: string;
  role: PlatformRole;
}

/** READ_ONLY_AUDITOR may never mutate. Everyone else may perform role-appropriate mutations. */
export function canMutate(role: PlatformRole): boolean {
  return role !== 'READ_ONLY_AUDITOR';
}

export function isSuperAdmin(role: PlatformRole): boolean {
  return role === 'SUPER_ADMIN';
}

/** Resolve the signed-in user's platform operator record, or null if they are not an active operator. */
export async function getSessionPlatformOperator(): Promise<PlatformOperator | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const rows = await db()<Array<{ role: PlatformRole }>>`
    select role from public.platform_operators
    where user_id = ${data.user.id} and status = 'active'
    limit 1
  `;
  const role = rows[0]?.role;
  if (!role) return null;
  // Best-effort activity stamp; never block the request on it.
  void db()`update public.platform_operators set last_used_at = now() where user_id = ${data.user.id}`.catch(() => {});
  return { userId: data.user.id, email: data.user.email ?? '', role };
}

/**
 * Require ANY active platform operator (read surfaces). Throws 403 otherwise. Pages should catch and
 * render notFound() so /admin's existence is not disclosed to non-operators.
 */
export async function requirePlatformOperator(): Promise<PlatformOperator> {
  const operator = await getSessionPlatformOperator();
  if (!operator) throw new HttpError('Platform operator access required.', 403);
  return operator;
}

/** Require an operator whose role is in the allowed set (specific privileged actions). */
export async function requirePlatformRole(...allowed: PlatformRole[]): Promise<PlatformOperator> {
  const operator = await requirePlatformOperator();
  if (!allowed.includes(operator.role)) {
    throw new HttpError(`This action requires platform role: ${allowed.join(' or ')}.`, 403);
  }
  return operator;
}

/** Require a role permitted to MUTATE (everything except READ_ONLY_AUDITOR), optionally within a set. */
export async function requirePlatformMutator(...allowed: PlatformRole[]): Promise<PlatformOperator> {
  const operator = await requirePlatformOperator();
  if (!canMutate(operator.role)) throw new HttpError('Read-only auditors cannot perform this action.', 403);
  if (allowed.length && !allowed.includes(operator.role)) {
    throw new HttpError(`This action requires platform role: ${allowed.join(' or ')}.`, 403);
  }
  return operator;
}
