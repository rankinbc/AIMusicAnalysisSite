const GRADE_COLOR = { A: '#34d399', B: '#00e5b0', C: '#fbbf24', D: '#fb923c', F: '#f43f5e' };
const gc = (g) => GRADE_COLOR[g?.[0]] ?? 'var(--muted)';

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}

export default function SongCard({ song, onOpen }) {
  const col = gc(song.latest_grade);
  return (
    <button className="song-card" onClick={() => onOpen(song.song_id)}>
      <div className="grade-pill" style={{ background: `${col}18`, border: `1px solid ${col}44`, color: col }}>
        {song.latest_grade?.[0] ?? '·'}
      </div>
      <div className="meta">
        <div className="name">{song.name}</div>
        <div className="sub">
          {song.version_count} version{song.version_count !== 1 ? 's' : ''}
          {song.latest_score != null && ` · ${Math.round(song.latest_score)}/100`}
          {song.last_analyzed && ` · ${fmt(song.last_analyzed)}`}
        </div>
      </div>
    </button>
  );
}
