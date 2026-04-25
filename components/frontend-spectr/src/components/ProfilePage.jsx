import { useState, useEffect } from 'react';
import { getEmail, changePassword, getJobs } from '../api/client';

const GRADE_COLOR = { A: '#34d399', B: '#00e5b0', C: '#fbbf24', D: '#fb923c', F: '#f43f5e' };
const gradeColor  = (g) => GRADE_COLOR[g?.[0]] ?? '#64748b';

const STATUS_META = {
  completed:  { label: 'Done',       color: 'var(--green)'  },
  processing: { label: 'Processing', color: 'var(--yellow)' },
  queued:     { label: 'Queued',     color: 'var(--muted)'  },
  failed:     { label: 'Failed',     color: 'var(--red)'    },
};

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

const inputStyle = {
  padding: '10px 14px', borderRadius: 8,
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 14, outline: 'none',
  fontFamily: 'inherit', width: '100%',
};

const mono = { fontFamily: "'JetBrains Mono', monospace" };

export default function ProfilePage({ onBack, onLogout, onViewJob }) {
  const email    = getEmail();
  const initials = email ? email[0].toUpperCase() : '?';

  const [currentPw, setCurrentPw] = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving,    setSaving]    = useState(false);
  const [success,   setSuccess]   = useState('');
  const [pwError,   setPwError]   = useState('');

  const [history,     setHistory]     = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError,   setHistError]   = useState('');

  // Load upload history from API on mount
  useEffect(() => {
    getJobs()
      .then(jobs => setHistory(Array.isArray(jobs) ? jobs : []))
      .catch(err => {
        if (err.status === 401) onLogout();
        else setHistError('Could not load history');
      })
      .finally(() => setHistLoading(false));
  }, [onLogout]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError(''); setSuccess('');
    if (newPw !== confirmPw) { setPwError('New passwords do not match'); return; }
    if (newPw.length < 6)   { setPwError('Password must be at least 6 characters'); return; }
    setSaving(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess('Password updated successfully');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      const msg = err.message ?? '';
      if (msg.includes('400')) setPwError('Current password is incorrect');
      else if (err.status === 401) onLogout();
      else setPwError(msg || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  const completedCount = history.filter(j => j.status === 'completed').length;
  const avgScore = completedCount
    ? Math.round(history.filter(j => j.score != null).reduce((s, j) => s + j.score, 0) / completedCount)
    : null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Nav ── */}
      <nav style={{
        padding: '14px 32px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, background: 'rgba(7,10,18,0.94)',
        backdropFilter: 'blur(12px)', zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onBack} style={{
            background: 'none', color: 'var(--muted)', fontSize: 12,
            padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)',
          }}>← Back</button>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '0.22em', color: 'var(--cyan)' }}>SPECTR</div>
        </div>
        <button onClick={onLogout} style={{
          background: 'none', color: 'var(--muted)', fontSize: 12,
          padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6,
        }}>Sign out</button>
      </nav>

      <div style={{ flex: 1, maxWidth: 760, margin: '0 auto', width: '100%', padding: '40px 24px' }}>

        {/* ── Avatar + stats strip ── */}
        <div className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 36 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
            background: 'var(--cyan-dim)', border: '2px solid var(--cyan)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 800, color: 'var(--cyan)',
          }}>{initials}</div>

          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{email || '—'}</div>
            <div style={{ ...mono, fontSize: 11, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.08em' }}>
              SPECTR account
            </div>
          </div>

          {/* Quick stats */}
          {!histLoading && history.length > 0 && (
            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ ...mono, fontSize: 24, fontWeight: 700, color: 'var(--cyan)', lineHeight: 1 }}>
                  {completedCount}
                </div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>analyses</div>
              </div>
              {avgScore != null && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ ...mono, fontSize: 24, fontWeight: 700, color: 'var(--yellow)', lineHeight: 1 }}>
                    {avgScore}
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>avg score</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Upload History ── */}
        <div className="fade-up" style={{ animationDelay: '0.05s', marginBottom: 24 }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>
            Upload History
          </div>

          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {histLoading && (
              <div style={{ padding: '32px', textAlign: 'center', ...mono, fontSize: 11, color: 'var(--muted)' }}>
                Loading…
              </div>
            )}

            {!histLoading && histError && (
              <div style={{ padding: '24px', ...mono, fontSize: 12, color: 'var(--red)' }}>
                {histError}
              </div>
            )}

            {!histLoading && !histError && history.length === 0 && (
              <div style={{ padding: '40px 32px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🎵</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 6 }}>No analyses yet</div>
                <div style={{ ...mono, fontSize: 11, color: 'var(--muted)' }}>Upload your first track to get started</div>
              </div>
            )}

            {!histLoading && history.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Track', 'Grade', 'Score', 'Date', ''].map((h, i) => (
                      <th key={i} style={{
                        ...mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                        color: 'var(--muted)', textAlign: i === 0 ? 'left' : 'center',
                        padding: '10px 16px', fontWeight: 500,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((job, idx) => {
                    const gc        = gradeColor(job.grade);
                    const statusMeta= STATUS_META[job.status] ?? STATUS_META.failed;
                    const canView   = job.status === 'completed' && typeof onViewJob === 'function';
                    const trackName = (job.filename ?? 'Untitled').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

                    return (
                      <tr
                        key={job.job_id}
                        style={{
                          borderBottom: idx < history.length - 1 ? '1px solid var(--border)' : 'none',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--card-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        {/* Track name + status pill */}
                        <td style={{ padding: '12px 16px', maxWidth: 260 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {trackName}
                          </div>
                          <span style={{
                            ...mono, fontSize: 9, padding: '1px 6px', borderRadius: 4, marginTop: 4, display: 'inline-block',
                            color: statusMeta.color,
                            background: `${statusMeta.color}18`,
                          }}>
                            {statusMeta.label}
                          </span>
                        </td>

                        {/* Grade */}
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          {job.grade ? (
                            <span style={{
                              ...mono, fontSize: 18, fontWeight: 800, color: gc,
                              filter: `drop-shadow(0 0 6px ${gc}66)`,
                            }}>
                              {job.grade}
                            </span>
                          ) : (
                            <span style={{ ...mono, fontSize: 11, color: 'var(--muted)' }}>—</span>
                          )}
                        </td>

                        {/* Score */}
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          {job.score != null ? (
                            <span style={{ ...mono, fontSize: 13, fontWeight: 600, color: gc }}>
                              {Math.round(job.score)}
                              <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400 }}>/100</span>
                            </span>
                          ) : (
                            <span style={{ ...mono, fontSize: 11, color: 'var(--muted)' }}>—</span>
                          )}
                        </td>

                        {/* Date */}
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <span style={{ ...mono, fontSize: 10, color: 'var(--muted)' }}>
                            {fmtDate(job.created_at)}
                          </span>
                        </td>

                        {/* Action */}
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          {canView && (
                            <button
                              onClick={() => onViewJob(job.job_id, job.filename)}
                              style={{
                                ...mono, fontSize: 10, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                                background: 'var(--cyan-dim)', border: '1px solid rgba(0,229,176,0.25)',
                                color: 'var(--cyan)', whiteSpace: 'nowrap',
                              }}
                            >
                              View →
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Change Password ── */}
        <div className="fade-up" style={{ animationDelay: '0.10s', marginBottom: 16 }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>
            Account
          </div>

          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '28px 32px', marginBottom: 12,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>Change Password</div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...mono, fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Current Password
                </span>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required style={inputStyle} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...mono, fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  New Password
                </span>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required style={inputStyle} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...mono, fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Confirm New Password
                </span>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required style={inputStyle} />
              </label>

              {pwError && (
                <div className="mono fade-in" style={{
                  fontSize: 12, color: 'var(--red)', background: 'var(--red-dim)',
                  border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, padding: '10px 14px',
                }}>{pwError}</div>
              )}
              {success && (
                <div className="mono fade-in" style={{
                  fontSize: 12, color: 'var(--green)', background: 'rgba(52,211,153,0.08)',
                  border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8, padding: '10px 14px',
                }}>{success}</div>
              )}

              <button type="submit" disabled={saving} style={{
                marginTop: 4, padding: '12px', borderRadius: 8,
                background: saving ? 'rgba(0,229,176,0.25)' : 'var(--cyan)',
                color: '#070a12', fontSize: 14, fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer', transition: 'background 0.2s',
              }}>
                {saving ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </div>

          {/* Sign out */}
          <div style={{
            background: 'var(--card)', border: '1px solid rgba(244,63,94,0.15)',
            borderRadius: 12, padding: '20px 32px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Sign out</div>
              <div style={{ ...mono, fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                End your current session
              </div>
            </div>
            <button onClick={onLogout} style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
              color: 'var(--red)', cursor: 'pointer',
            }}>Sign out</button>
          </div>
        </div>

      </div>
    </div>
  );
}
