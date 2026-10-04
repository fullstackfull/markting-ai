import 'server-only';
import postgres from 'postgres';
import { env } from '@/lib/env';

let client: ReturnType<typeof postgres> | undefined;

export function db() {
  client ??= postgres(env().SUPABASE_DB_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: 'adport-cloud', role: env().ADPORT_DB_ROLE },
    // Transform SQL column names only. postgres.camel's value transform also
    // rewrites JSON object keys, which would corrupt snake_case policy data.
    transform: { column: postgres.camel.column },
  });
  return client;
}

export async function closeDbForTests(): Promise<void> {
  if (client) await client.end({ timeout: 2 });
  client = undefined;
}

type Tx = postgres.TransactionSql<Record<string, never>>;

/**
 * TENANT RLS BACKSTOP (Phase B / B17-B18).
 *
 * Runs `fn` inside a transaction that first sets the transaction-local GUC
 * `app.current_organization_id`. The restrictive RLS policies added in
 * 20261018000000_tenant_rls_backstop.sql read that GUC and clamp `adport_backend` to the named
 * org's rows (global rows whose organization_id is null still pass). This is a defense-in-depth
 * backstop LAYERED ON TOP of the application-level `where organization_id = …` scoping — NOT a
 * replacement for it. Every query must still carry its own org WHERE clause.
 *
 * CAVEAT — single auto-commit statements issued directly through `db()` do NOT set the GUC; the
 * restrictive policy is a deliberate no-op when the GUC is unset, so service-job / cross-tenant
 * reads keep working and those paths rely on their WHERE clause. `withTenant` is the path that adds
 * the DB-level clamp, used by the multi-statement tenant transactions that opt into it.
 *
 * `set_config(…, true)` makes the GUC transaction-local, so it is cleared on commit/rollback and
 * never leaks to the next checkout of this pooled connection.
 */
export async function withTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.current_organization_id', ${organizationId}, true)`;
    return fn(tx as Tx);
  }) as Promise<T>;
}
