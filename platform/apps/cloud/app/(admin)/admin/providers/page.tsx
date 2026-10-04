import { requirePlatformOperator } from '@/lib/platform/auth';
import { providerFleet } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';

export default async function AdminProvidersPage() {
  await requirePlatformOperator();
  const { connections, health } = await providerFleet();
  return (
    <>
      <div className="admin-card">
        <h2>Connection status by provider (fleet)</h2>
        <p className="admin-note">Cross-tenant rollup of public.connections. The base model has three states (connected/error/revoked); richer AUTH_EXPIRED/RATE_LIMITED/DEGRADED classification is tracked in provider health below. No tokens/secrets are shown.</p>
        {connections.length === 0 ? <p className="admin-note">No connections.</p> : (
          <table className="admin-table"><thead><tr><th>Provider</th><th>Status</th><th>Count</th></tr></thead>
            <tbody>{connections.map((c, i) => (
              <tr key={i}><td>{c.provider}</td><td><span className={`admin-tag ${c.status === 'connected' ? 'ok' : c.status === 'revoked' ? 'bad' : 'warn'}`}>{c.status}</span></td><td>{c.n}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Provider health states</h2>
        {health.length === 0 ? <p className="admin-note">NOT_AVAILABLE — no provider-health probes recorded (markting_provider_health is written by the governed ops path).</p> : (
          <table className="admin-table"><thead><tr><th>Provider</th><th>State</th><th>Count</th></tr></thead>
            <tbody>{health.map((h, i) => (
              <tr key={i}><td>{h.provider}</td><td><span className={`admin-tag ${h.state === 'CONNECTED' ? 'ok' : h.state === 'DISABLED' || h.state === 'ERROR' || h.state === 'AUTH_EXPIRED' ? 'bad' : 'warn'}`}>{h.state}</span></td><td>{h.n}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
