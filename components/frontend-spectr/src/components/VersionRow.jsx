const GRADE_COLOR = { A: '#34d399', B: '#00e5b0', C: '#fbbf24', D: '#fb923c', F: '#f43f5e' };
const gc = (g) => GRADE_COLOR[g?.[0]] ?? 'var(--muted)';

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

export default function VersionRow({ version, onAnalyze, onView, onDelete, busy }) {
  const col = gc(version.latest_grade);
  return (
    <div className="version-row">
      <div className="vn">v{version.version_number}</div>
      <div className="meta">
        <div className="label">{version.label || '(unlabeled)'}</div>
        <div className="sub">
          {fmt(version.created_at)}
          {version.latest_score != null && ` · ${Math.round(version.latest_score)}/100`}
          {' · '}{version.analysis_count} analysis{version.analysis_count !== 1 ? 'es' : ''}
        </div>
      </div>
      <div className="grade" style={{ color: col }}>{version.latest_grade?.[0] ?? '—'}</div>
      <div className="actions">
        {version.latest_job_id && (
          <button onClick={() => onView(version.latest_job_id)}>View</button>
        )}
        <button onClick={() => onAnalyze(version.version_id)} disabled={busy}>
          {busy ? 'Starting…' : (version.latest_job_id ? '↺ Re-analyze' : 'Analyze')}
        </button>
        <button onClick={() => onDelete(version.version_id)} className="danger">Delete</button>
      </div>
    </div>
  );
}
