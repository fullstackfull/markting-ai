import { db } from '@/lib/db';
import { computeHealth, healthHttpStatus, type HealthSignals } from '@/lib/markting/ops/health';

/**
 * Phase C.5 (7) — operator/internal health endpoint. Returns the computed component states as JSON.
 *
 * OPERATOR-SAFE: the body is only `computeHealth`'s output (state + terse reason codes). It carries no
 * secret, connection string, hostname, version, or stack trace. The DB probe is a trivial `select 1`
 * wrapped so ANY failure collapses to DATABASE: UNAVAILABLE — never a thrown stack. Probes that are
 * risky or not yet wired are passed as absent signals, so they report UNKNOWN rather than a fabricated
 * HEALTHY.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function probeDatabase(): Promise<boolean> {
  try {
    await db()`select 1`;
    return true;
  } catch {
    return false; // never leak the error; DATABASE becomes UNAVAILABLE.
  }
}

export async function GET(): Promise<Response> {
  const signals: HealthSignals = {
    dbReachable: await probeDatabase(),
    // Queue/worker/provider/webhook/AI-gateway probes are not wired here yet. Passing them as absent
    // keeps them honestly UNKNOWN instead of fabricating HEALTHY.
  };

  const report = computeHealth(signals);
  return Response.json(report, {
    status: healthHttpStatus(report.status),
    headers: { 'Cache-Control': 'no-store' },
  });
}
