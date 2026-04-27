import { useState, useEffect } from 'react';
import { listSongs, reanalyzeSong } from '../api/songs.js';
import { getJobResults } from '../api/client.js';
import { adaptResult } from '../api/adapter.js';

const GRADE_COLOR = { A: '#34d399', B: '#00e5b0', C: '#fbbf24', D: '#fb923c', F: '#f43f5e' };
const gc = (g) => GRADE_COLOR[g?.[0]] ?? 'var(--muted)';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}

export default function SongLibrary({ onJobStarted, onViewResult, onLogout }) {
  const [songs,    setSongs]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState({});   // song_id → true while re-analyzing
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    listSongs()
      .then(setSongs)
      .catch(err => { if (err.message?.includes('401')) onLogout?.(); })
      .finally(() => setLoading(false));
  }, []);

  const handleReanalyze = async (songId) => {
    setBusy(b => ({ ...b, [songId]: true }));
    try {
      const { job_id } = await reanalyzeSong(songId);
      onJobStarted(job_id);
    } catch (err) {
      if (err.message?.includes('401')) onLogout?.();
      setBusy(b => ({ ...b, [songId]: false }));
    }
  };

  const handleView = async (jobId, songName) => {
    try {
      const raw = await getJobResults(jobId);
      onViewResult(adaptResult(raw, songName), jobId);
    } catch (err) {
      if (err.message?.includes('401')) onLogout?.();
    }
  };

  if (loading) return null;
  if (songs.length === 0) return null;

  const visible = expanded ? songs : songs.slice(0, 3);

  return (
    <div style={{ width: '100%', maxWidth: 560, marginTop: 36 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Song Library · {songs.length} track{songs.length !== 1 ? 's' : ''}
        </span>
        {songs.length > 3 && (
          <button onClick={() => setExpanded(e => !e)} style={{
            background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11,
            cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
          }}>
            {expanded ? 'show less' : `+${songs.length - 3} more`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map(song => {
          const isBusy = !!busy[song.song_id];
          const gradeCol = gc(song.latest_grade);
          return (
            <div key={song.song_id} style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              {/* Grade badge */}
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: song.latest_grade ? `${gradeCol}18` : 'var(--surface)',
                border: `1px solid ${song.latest_grade ? `${gradeCol}44` : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, color: gradeCol,
              }}>
                {song.latest_grade?.[0] ?? '·'}
              </div>

              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: 13, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {song.name}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>
                  {song.latest_score != null ? `${Math.round(song.latest_score)}/100 · ` : ''}
                  {song.analysis_count} run{song.analysis_count !== 1 ? 's' : ''}
                  {song.last_analyzed ? ` · ${fmtDate(song.last_analyzed)}` : ''}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {song.latest_job_id && (
                  <button
                    onClick={() => handleView(song.latest_job_id, song.name)}
                    style={{
                      background: 'none', border: '1px solid var(--border)',
                      color: 'var(--muted)', fontSize: 11, padding: '4px 10px',
                      borderRadius: 6, cursor: 'pointer', fontFamily: 'Syne',
                    }}
                  >
                    View
                  </button>
                )}
                <button
                  onClick={() => handleReanalyze(song.song_id)}
                  disabled={isBusy}
                  style={{
                    background: isBusy ? 'rgba(0,229,176,0.08)' : 'rgba(0,229,176,0.14)',
                    border: '1px solid rgba(0,229,176,0.35)',
                    color: 'var(--cyan)', fontSize: 11, padding: '4px 10px',
                    borderRadius: 6, cursor: isBusy ? 'wait' : 'pointer',
                    fontFamily: 'Syne', fontWeight: 600,
                  }}
                >
                  {isBusy ? 'Starting…' : '↺ Re-analyze'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
