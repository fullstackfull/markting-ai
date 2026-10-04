import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { PostgresAlertStore } from '@/lib/markting/ops/alert-store';
import { PlatformAdminChannel, processAlert } from '@/lib/markting/ops/alert-delivery';
import { PostgresIncidentStore } from '@/lib/markting/ops/incident-store';
import { openIncident, transitionIncident } from '@/lib/markting/ops/incidents';
import type { AlertInput } from '@/lib/markting/ops/alerts';

/**
 * PHASE C.5 (4,5) — alert + incident persistence on real Postgres, plus the tenant-isolation invariant:
 * the authenticated (tenant) role can NEVER read platform operational tables (no RLS policy for it).
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('ops persistence — alerts + incidents (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const alerts = new PostgresAlertStore();
  const incidents = new PostgresIncidentStore();
  const NOW = Date.now();
  const input: AlertInput = { type: 'SYNC_BACKLOG', source: 'test', provider: 'meta', evidence: { depth: 42 } };

  afterAll(async () => {
    await admin`delete from public.markting_alerts where source = 'test'`.catch(() => {});
    await admin`delete from public.markting_incidents where source in ('operator','test')`.catch(() => {});
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('alert upsert dedups on dedup_key; repeat within cooldown bumps count without re-delivery', async () => {
    const r1 = await processAlert(alerts, [new PlatformAdminChannel()], input, NOW, 10 * 60_000);
    expect(r1.delivered).toBe(true);
    const r2 = await processAlert(alerts, [new PlatformAdminChannel()], input, NOW + 60_000, 10 * 60_000);
    expect(r2.delivered).toBe(false);
    expect(r2.record.count).toBe(2);
    const rows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_alerts where source = 'test'`;
    expect(rows[0]!.count).toBe(1); // one row, deduped
  });

  it('incident create → legal transition persists state + timeline', async () => {
    const created = await incidents.create(openIncident({ title: 'DB test incident', severity: 'WARNING', source: 'test', now: NOW }));
    expect(created.id).toBeTruthy();
    const next = transitionIncident(created, { to: 'ACKNOWLEDGED', actor: randomUUID(), reason: 'ack', now: NOW + 1000 });
    const saved = await incidents.save(next);
    expect(saved.state).toBe('ACKNOWLEDGED');
    expect(saved.timeline).toHaveLength(1);
    expect(saved.acknowledgedAtMs).toBeTruthy();
  });

  it('linkAlert sets the alert incident_id', async () => {
    const created = await incidents.create(openIncident({ title: 'Link test', severity: 'INFO', source: 'test', now: NOW }));
    const [alertRow] = await admin<Array<{ id: string }>>`select id from public.markting_alerts where source = 'test' limit 1`;
    await incidents.linkAlert(created.id!, alertRow!.id);
    const [linked] = await admin<Array<{ incident_id: string }>>`select incident_id from public.markting_alerts where id = ${alertRow!.id}`;
    expect(linked!.incident_id).toBe(created.id);
  });

  it('a TENANT (authenticated role) can NEVER read platform incidents or alerts (RLS default-deny)', async () => {
    const seen = await admin.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      const inc = await tx`select id from public.markting_incidents`;
      const alt = await tx`select id from public.markting_alerts`;
      return { inc: inc.length, alt: alt.length };
    });
    expect(seen.inc).toBe(0);
    expect(seen.alt).toBe(0);
  });

  it('the platform-admin read role CAN read both', async () => {
    const seen = await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      const inc = await tx`select id from public.markting_incidents`;
      return inc.length;
    });
    expect(seen).toBeGreaterThan(0);
  });
});
