'use client';

import { useEffect, useState } from 'react';

interface ReportFile { path: string; media_type: string; byte_size: number }
interface ReportRun {
  id: string; cadence: 'weekly' | 'monthly'; end: string; created_at: string; reconciled: boolean;
  current_window: { start: string; end: string }; previous_window: { start: string; end: string };
  files: ReportFile[]; pdf: string | null; unavailable: string[];
  summary: { platforms?: Array<{ platform: string; account_ref: string; spend_current: string; spend_previous: string; spend_change: string; cpa_current: string; cpa_previous: string }>; cross_platform_total?: string | null };
}

/** Engine (AI analysis) reports: trigger a deterministic weekly/monthly run and download its files. */
export function EngineReports({ organizationId, canRun }: { organizationId: string; canRun: boolean }) {
  const [runs, setRuns] = useState<ReportRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = `?organizationId=${encodeURIComponent(organizationId)}`;

  async function load() {
    const response = await fetch(`/api/reports/engine${query}`, { cache: 'no-store' });
    const result = await response.json().catch(() => ({})) as { reports?: ReportRun[]; error?: string };
    if (!response.ok) { setError(result.error ?? 'Could not load engine reports.'); setRuns([]); return; }
    setError(null);
    setRuns(result.reports ?? []);
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(cadence: 'weekly' | 'monthly') {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/reports/engine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId, cadence }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(result.error ?? 'Report run failed.');
    await load();
    setBusy(false);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>AI analysis reports</h2>
        <span className="card-note">
          Deterministic period comparison rendered by the analysis engine. Read-only on ad platforms.
        </span>
      </div>
      {canRun ? (
        <div className="row-actions" style={{ marginBottom: 12 }}>
          <button type="button" className="button small" disabled={busy} onClick={() => void run('weekly')}>{busy ? 'Running…' : 'Run weekly report'}</button>
          <button type="button" className="button secondary small" disabled={busy} onClick={() => void run('monthly')}>Run monthly report</button>
        </div>
      ) : null}
      {error ? <div className="error-callout">{error}</div> : null}
      {runs === null ? <div className="skeleton-line" style={{ width: '40%' }} /> : runs.length === 0 ? (
        <div className="empty"><p>No engine reports yet.</p></div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>Report</th><th>Window</th><th>Platforms</th><th>Files</th></tr></thead>
          <tbody>
            {runs.map((report) => (
              <tr key={report.id}>
                <td><strong>{report.cadence === 'weekly' ? 'Weekly' : 'Monthly'}</strong><div className="cell-sub">{new Date(report.created_at).toLocaleString()} · {report.reconciled ? 'reconciled' : 'NOT reconciled'}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>{report.current_window.start} → {report.current_window.end}<div className="cell-sub">vs {report.previous_window.start} → {report.previous_window.end}</div></td>
                <td>
                  {(report.summary.platforms ?? []).map((platform) => (
                    <div key={platform.platform} className="cell-sub" style={{ marginTop: 0 }}>
                      <strong>{platform.platform}</strong> · spend {platform.spend_current} ({platform.spend_change}) · CPA {platform.cpa_current}
                    </div>
                  ))}
                  {report.unavailable.length ? <div className="cell-sub text-danger">Unavailable: {report.unavailable.join('; ')}</div> : null}
                </td>
                <td>
                  <div className="row-actions">
                    {report.files.map((file) => (
                      <a key={file.path} className="button secondary small" href={`/api/reports/engine/${encodeURIComponent(file.path)}${query}`}>
                        {file.media_type === 'application/pdf' ? 'PDF' : 'HTML'}
                      </a>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}
