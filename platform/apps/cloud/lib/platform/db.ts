import 'server-only';
import postgres from 'postgres';
import { env } from '@/lib/env';

/**
 * WAVE 1 — the platform-admin cross-tenant READ connection.
 *
 * Connects under the dedicated `adport_platform_admin` DB role, which is granted SELECT only (see
 * 20261014000000_platform_admin.sql). This is the one trusted server path for cross-tenant platform
 * reads: it is physically distinct from the tenant `adport_backend` path, so a bug in an admin read
 * query can never mutate tenant data, and the browser never receives this role. Platform MUTATIONS
 * (operator roster, audit writes, org actions) go through the ordinary `db()` (adport_backend) AFTER a
 * requirePlatformOperator/requirePlatformRole guard — not through here.
 */
let client: ReturnType<typeof postgres> | undefined;

export function platformDb() {
  client ??= postgres(env().SUPABASE_DB_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: 'adport-platform-admin', role: 'adport_platform_admin' },
    transform: { column: postgres.camel.column },
  });
  return client;
}

export async function closePlatformDbForTests(): Promise<void> {
  if (client) await client.end({ timeout: 2 });
  client = undefined;
}
