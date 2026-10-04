import postgres from 'postgres';

/**
 * WAVE 19 — platform admin notification generator. Computes high-value platform conditions from live
 * DB state and upserts deduped notifications into public.platform_admin_notifications. Idempotent:
 * the partial unique index on dedupe_key (where acknowledged=false) collapses repeats, so re-running
 * (e.g. on a schedule) does not flood the inbox. Run: node scripts/platform-admin-notify.mjs
 */
const DB = process.env.SUPABASE_DB_URL;
if (!DB) { console.error('platform-admin-notify: SUPABASE_DB_URL required'); process.exit(1); }
const sql = postgres(DB, { max: 2 });

async function emit(kind, severity, title, detail, dedupeKey) {
  await sql`
    insert into public.platform_admin_notifications (kind, severity, title, detail, dedupe_key)
    values (${kind}, ${severity}, ${title}, ${detail}, ${dedupeKey})
    on conflict (dedupe_key) where acknowledged = false do nothing`;
}

try {
  const day = new Date().toISOString().slice(0, 10);

  const [failures] = await sql`select count(*)::int as n from public.billing_failures where resolved = false`;
  if (failures.n >= 5) await emit('billing_failure_spike', 'critical', `${failures.n} open payment failures`, 'Investigate dunning / card declines.', `billing_failure_spike:${day}`);

  const kills = await sql`select scope, scope_key from public.markting_kill_switches where active = true`;
  for (const k of kills) {
    const sev = k.scope === 'GLOBAL' ? 'critical' : 'warning';
    await emit('kill_switch_active', sev, `${k.scope} kill switch active`, `scope_key=${k.scope_key || '(global)'}`, `kill_switch_active:${k.scope}:${k.scope_key}`);
  }

  const [stuck] = await sql`select count(*)::int as n from public.markting_commerce_sync_state where consecutive_errors >= 3`;
  if (stuck.n > 0) await emit('commerce_sync_stuck', 'warning', `${stuck.n} store syncs stuck`, 'consecutive_errors >= 3 on commerce sync state.', `commerce_sync_stuck:${day}`);

  const [gaveUp] = await sql`select count(*)::int as n from public.markting_reconciliation_jobs where status = 'GAVE_UP'`;
  if (gaveUp.n > 0) await emit('reconciliation_gave_up', 'warning', `${gaveUp.n} reconciliation jobs gave up`, 'Manual reconciliation may be required (within Phase-0 contract).', `reconciliation_gave_up:${day}`);

  console.log(`platform-admin-notify: evaluated (failures=${failures.n}, kills=${kills.length}, stuckSync=${stuck.n}, gaveUp=${gaveUp.n})`);
} catch (err) {
  console.error('platform-admin-notify FAILED:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
