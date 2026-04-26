import { useMemo, useState } from 'react';
import { confirmStemMapping } from '../api/client';

const ALL_ROLES = [
  'drums', 'kick', 'snare', 'hats', 'bass',
  'vocals', 'lead', 'pad', 'fx', 'other',
];

export default function StemMappingPage({ jobId, proposals, alsTrackNames, onConfirmed, onLogout }) {
  const [rows, setRows] = useState(() =>
    (proposals ?? []).map(p => ({
      file: p.file,
      role: p.proposed_role,
      als_track: p.proposed_als_track ?? null,
      confidence: p.confidence,
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const dupRoles = useMemo(() => {
    const counts = new Map();
    rows.forEach(r => counts.set(r.role, (counts.get(r.role) ?? 0) + 1));
    return [...counts.entries()].filter(([, c]) => c > 1).map(([r]) => r);
  }, [rows]);

  const isValid = dupRoles.length === 0 && rows.every(r => r.role);
  const hasAls = (alsTrackNames ?? []).length > 0;

  function update(i, patch) {
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function handleConfirm() {
    setError('');
    setSubmitting(true);
    try {
      await confirmStemMapping(jobId, rows.map(r => ({
        file: r.file, role: r.role, als_track: r.als_track,
      })));
      onConfirmed(jobId);
    } catch (err) {
      setError(err.message ?? 'Failed to confirm mapping');
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={{
        padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)', position: 'sticky', top: 0,
        background: 'rgba(7,10,18,0.94)', backdropFilter: 'blur(12px)', zIndex: 100,
      }}>
        <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '0.22em', color: 'var(--cyan)' }}>SPECTR</div>
        <button onClick={onLogout} style={{
          background: 'none', color: 'var(--muted)', fontSize: 12, padding: '5px 10px',
          border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
        }}>Sign out</button>
      </nav>

      <div style={{ flex: 1, padding: '60px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="fade-up" style={{ width: '100%', maxWidth: 720, textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontWeight: 800, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.02em' }}>
            Confirm stem mapping
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 12, fontSize: 14 }}>
            We've matched each stem to a role
            {hasAls ? ' and to a track in your Ableton project' : ''}.
            Adjust if anything looks off, then start analysis.
          </p>
        </div>

        <div className="fade-up" style={{
          width: '100%', maxWidth: 720,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          <div className="mono" style={{
            display: 'grid',
            gridTemplateColumns: hasAls ? '2fr 1fr 1.4fr' : '2fr 1fr',
            gap: 12, padding: '10px 16px',
            fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase',
            color: 'var(--muted)', borderBottom: '1px solid var(--border)',
          }}>
            <div>File</div>
            <div>Role</div>
            {hasAls && <div>.als track</div>}
          </div>
          {rows.map((r, i) => {
            const isDup = dupRoles.includes(r.role);
            return (
              <div key={r.file} style={{
                display: 'grid',
                gridTemplateColumns: hasAls ? '2fr 1fr 1.4fr' : '2fr 1fr',
                gap: 12, padding: '12px 16px', alignItems: 'center',
                borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)',
                background: isDup ? 'rgba(244,63,94,0.06)' : 'transparent',
              }}>
                <div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.file}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>
                    confidence {Math.round(r.confidence * 100)}%
                  </div>
                </div>
                <select
                  value={r.role}
                  onChange={e => update(i, { role: e.target.value })}
                  style={{
                    background: 'var(--surface)', color: 'var(--text)',
                    border: `1px solid ${isDup ? 'var(--red)' : 'var(--border)'}`,
                    borderRadius: 6, padding: '6px 8px', fontSize: 12,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {ALL_ROLES.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
                {hasAls && (
                  <select
                    value={r.als_track ?? ''}
                    onChange={e => update(i, { als_track: e.target.value || null })}
                    style={{
                      background: 'var(--surface)', color: 'var(--text)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      padding: '6px 8px', fontSize: 12,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    <option value="">— none —</option>
                    {alsTrackNames.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        {dupRoles.length > 0 && (
          <div className="mono fade-in" style={{
            marginTop: 16, fontSize: 12, color: 'var(--red)',
            background: 'var(--red-dim)', border: '1px solid rgba(244,63,94,0.2)',
            borderRadius: 8, padding: '10px 18px', maxWidth: 720,
          }}>
            Duplicate role: {dupRoles.join(', ')} — pick a unique role for each stem.
          </div>
        )}

        {error && (
          <div className="mono fade-in" style={{
            marginTop: 16, fontSize: 12, color: 'var(--red)',
            background: 'var(--red-dim)', border: '1px solid rgba(244,63,94,0.2)',
            borderRadius: 8, padding: '10px 18px', maxWidth: 720,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!isValid || submitting}
          style={{
            marginTop: 32, padding: '14px 40px', borderRadius: 10,
            background: (isValid && !submitting) ? 'var(--cyan)' : 'rgba(0,229,176,0.25)',
            color: '#070a12', fontSize: 15, fontWeight: 800, letterSpacing: '0.04em',
            boxShadow: (isValid && !submitting) ? '0 0 32px rgba(0,229,176,0.3)' : 'none',
            cursor: (isValid && !submitting) ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
          }}
        >
          {submitting ? 'Starting analysis…' : 'Looks right — start analysis'}
        </button>
      </div>
    </div>
  );
}
