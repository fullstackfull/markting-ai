import 'server-only';
import { db } from '@/lib/db';
import { parsePlaybook, type PlaybookPolicy } from './playbook';

/** Phase 3I — tenant playbook persistence (one row per org, org-scoped). */
export async function loadPlaybook(organizationId: string): Promise<PlaybookPolicy> {
  const rows = await db()<Array<{ policy: unknown }>>`
    select policy from public.markting_playbooks where organization_id = ${organizationId} limit 1`;
  return rows[0] ? parsePlaybook(rows[0].policy) : {};
}

export async function savePlaybook(organizationId: string, raw: unknown): Promise<PlaybookPolicy> {
  const policy = parsePlaybook(raw); // validates + strips unknown keys
  await db()`
    insert into public.markting_playbooks (organization_id, policy, updated_at)
    values (${organizationId}, ${db().json(policy as never)}, now())
    on conflict (organization_id) do update set policy = excluded.policy, updated_at = now()`;
  return policy;
}
