export function SectionStub({ title, status = 'PARTIAL', children }: { title: string; status?: string; children?: React.ReactNode }) {
  return (
    <div className="admin-card">
      <h2>{title} <span className="admin-tag warn">{status}</span></h2>
      <p className="admin-note">{children ?? 'Backend evidence exists in the audited discovery (docs/platform-admin). This operator surface is scheduled in the implementation roadmap and not yet built; no fabricated data is shown here.'}</p>
    </div>
  );
}
