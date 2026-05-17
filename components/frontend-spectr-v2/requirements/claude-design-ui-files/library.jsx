/* SPECTR — Library + Song Detail
 *
 * Library surfaces the iteration arc on each card:
 *   - Grade chips for every version
 *   - Score sparkline showing v1 → v_latest
 *   - Score delta callout (e.g., "+20")
 *
 * Clicking a card opens SongDetailPage — the per-song view with version
 * timeline, version list, and (placeholder for) cross-version delta analysis.
 */

const { useState } = React;

function LibraryPage({ library, onOpenSong, onOpenAnalysis }) {
  const [view, setView] = useState('grid');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '24px 24px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em' }}>Your library</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {library.length} songs · {library.reduce((a, b) => a + b.versionCount, 0)} versions · last edit today
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
          {['all', 'A grade', 'B grade', 'Needs work', 'In progress', 'Archived'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className="btn sm" style={{
              background: filter === f ? 'var(--cyan-dim)' : 'rgba(255,255,255,0.03)',
              borderColor: filter === f ? 'rgba(0,229,176,0.32)' : 'var(--border)',
              color: filter === f ? 'var(--cyan)' : 'var(--text-2)',
            }}>{f}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 11 }}>
            <span className="mono" style={{ letterSpacing: '0.10em' }}>SORT</span>
            <select value={sort} onChange={e => setSort(e.target.value)} className="mono" style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 11, padding: '4px 8px', borderRadius: 6,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              <option value="recent">Recent</option>
              <option value="progress">Most progress</option>
              <option value="grade">Highest grade</option>
              <option value="versions">Most versions</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 2, padding: 3, border: '1px solid var(--border)', borderRadius: 7, background: 'rgba(255,255,255,0.03)' }}>
            {['grid', 'list'].map(v => (
              <button key={v} onClick={() => setView(v)} className="mono" style={{
                fontSize: 10, fontWeight: 600,
                padding: '4px 10px', borderRadius: 5,
                color: view === v ? 'var(--text)' : 'var(--muted)',
                background: view === v ? 'var(--card-hover)' : 'transparent',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{v}</button>
            ))}
          </div>
          <button className="btn sm primary">+ New song</button>
        </div>
      </div>

      {view === 'grid' ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}>
          {library.map(s => <LibraryCard key={s.id} song={s} onOpen={onOpenSong} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {library.map(s => <LibraryRow key={s.id} song={s} onOpen={onOpenSong} />)}
        </div>
      )}
    </div>
  );
}

// ── Library card — surfaces the iteration arc ─────────────────────────────

function LibraryCard({ song, onOpen }) {
  const cur = song.versions[song.versions.length - 1];
  return (
    <button onClick={() => onOpen(song.id)} style={{
      textAlign: 'left',
      padding: 0,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      cursor: 'pointer',
      transition: 'border-color .15s, transform .15s',
    }}
    onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(0,229,176,0.32)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>

      {/* Cover with overlay */}
      <div style={{ position: 'relative', aspectRatio: '2.1', overflow: 'hidden' }}>
        <CoverArt hue={song.hue} size="fluid" />
        <div style={{ position: 'absolute', inset: 0, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <GradePill grade={song.grade} size="sm" />
            <span className="pill" style={{ background: 'rgba(7,10,18,0.55)', backdropFilter: 'blur(4px)' }}>
              {song.versionCount} version{song.versionCount === 1 ? '' : 's'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 22 }}>
              {Array.from({ length: 24 }).map((_, i) => {
                const v = 0.3 + (Math.sin(i * 0.7 + song.hue) * 0.5 + 0.5) * 0.7;
                return <div key={i} style={{ width: 2, height: `${v * 100}%`, background: 'rgba(255,255,255,0.75)', borderRadius: 1 }} />;
              })}
            </div>
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--cyan)', color: '#06151a',
              display: 'grid', placeItems: 'center',
              fontSize: 11, fontWeight: 700,
              boxShadow: '0 0 12px rgba(0,229,176,0.4)',
            }}>▶</span>
          </div>
        </div>
      </div>

      {/* Title + meta */}
      <div style={{ padding: '12px 14px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{song.name}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)', marginLeft: 'auto' }}>v{cur.v}</span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
          {song.genre} · {song.bpm} BPM · {song.key}
        </div>
      </div>

      {/* Version arc — the iteration story */}
      <div style={{ padding: '8px 14px 12px' }}>
        <VersionArc versions={song.versions} delta={song.scoreDelta} />
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(255,255,255,0.012)',
      }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
          {song.updatedDays === 0 ? 'edited today' : `edited ${song.updatedDays}d ago`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>▶ {song.plays}</span>
          {song.versionCount >= 2 && (
            <span className="mono" style={{ fontSize: 9, color: 'var(--violet)' }}>v{cur.v - 1}↔v{cur.v}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Version arc — mini sparkline of grade history ─────────────────────────

function VersionArc({ versions, delta, compact = false }) {
  const w = 240;
  const h = compact ? 32 : 44;
  const padX = 8;
  const padY = compact ? 6 : 10;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const minScore = Math.min(...versions.map(v => v.score), 40);
  const maxScore = Math.max(...versions.map(v => v.score), 100);
  const range = Math.max(20, maxScore - minScore);
  const padded = (s) => ((s - minScore + 10) / (range + 20)) * innerH;

  const points = versions.map((v, i) => {
    const x = versions.length === 1
      ? innerW / 2
      : (i / (versions.length - 1)) * innerW;
    const y = innerH - padded(v.score);
    return { x: padX + x, y: padY + y, v };
  });

  const lineD = points.length > 1
    ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`
    : null;
  const fillD = points.length > 1
    ? `${lineD} L ${points[points.length - 1].x},${h - padY} L ${points[0].x},${h - padY} Z`
    : null;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>VERSION ARC</span>
        {delta != null && (
          <span className="mono" style={{
            fontSize: 10, fontWeight: 700,
            color: delta > 0 ? 'var(--cyan)' : delta < 0 ? 'var(--red)' : 'var(--muted)',
          }}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'} {delta > 0 ? '+' : ''}{delta} pts
          </span>
        )}
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {fillD && <path d={fillD} fill="var(--cyan)" opacity="0.10" />}
        {lineD && <path d={lineD} stroke="var(--cyan)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((p, i) => {
          const isLast = i === points.length - 1;
          const c = gradeColor(p.v.grade);
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={isLast ? 4 : 3} fill={c}
                stroke={isLast ? '#06151a' : 'transparent'} strokeWidth={isLast ? 1.5 : 0}
                style={isLast ? { filter: `drop-shadow(0 0 5px ${c})` } : {}} />
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {points.map((p, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            opacity: i === points.length - 1 ? 1 : 0.7,
          }}>
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: gradeColor(p.v.grade) }}>
              {p.v.grade}
            </span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--dim)' }}>v{p.v.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryRow({ song, onOpen }) {
  const cur = song.versions[song.versions.length - 1];
  return (
    <button onClick={() => onOpen(song.id)} style={{
      width: '100%', textAlign: 'left',
      padding: '12px 14px',
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'grid',
      gridTemplateColumns: '48px 1.2fr 1fr 160px 60px',
      alignItems: 'center', gap: 16,
      transition: 'background .15s',
    }}
    onMouseOver={e => e.currentTarget.style.background = 'var(--card-hover)'}
    onMouseOut={e => e.currentTarget.style.background = 'var(--card)'}>
      <CoverArt hue={song.hue} size="sm" />
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{song.name}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
          {song.versionCount} versions · last v{cur.v} {cur.label && `· ${cur.label}`}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>{song.genre} · {song.bpm} BPM · {song.key}</div>
      <div>
        <VersionStrip versions={song.versions} />
      </div>
      <GradePill grade={song.grade} size="sm" />
    </button>
  );
}

function VersionStrip({ versions }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {versions.map((v, i) => (
        <div key={i} style={{
          padding: '2px 5px', borderRadius: 4,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9, fontWeight: 700,
          background: `${gradeColor(v.grade)}14`,
          border: `1px solid ${gradeColor(v.grade)}30`,
          color: gradeColor(v.grade),
        }}>{v.grade}</div>
      ))}
    </div>
  );
}

// ── Song Detail page ──────────────────────────────────────────────────────

function SongDetailPage({ song, onBack, onOpenAnalysis, onPublish }) {
  const cur = song.versions.find(v => v.current) || song.versions[song.versions.length - 1];
  const [selected, setSelected] = useState(cur.v);
  const [compare, setCompare] = useState(null);

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 24px 80px' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <button onClick={onBack} className="btn ghost sm" style={{ marginBottom: 14 }}>← Library</button>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 }}>
          <CoverArt hue={song.hue} size="lg" />
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 6 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              SONG · {song.versionCount} VERSION{song.versionCount === 1 ? '' : 'S'}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>{song.name}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="pill cyan">{song.genre}</span>
              <span className="pill"><span className="mono">{song.bpm}</span> BPM</span>
              <span className="pill"><span className="mono">{song.key}</span></span>
              <span className="pill">▶ {song.plays} plays</span>
              {song.scoreDelta > 0 && (
                <span className="pill green">↑ +{song.scoreDelta} pts across versions</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
            <button className="btn sm">↺ Re-analyze {cur.v ? `v${cur.v}` : ''}</button>
            <button onClick={onPublish} className="btn sm" style={{
              background: 'rgba(167,139,250,0.08)',
              borderColor: 'rgba(167,139,250,0.32)',
              color: 'var(--violet)',
              fontWeight: 700,
            }}>★ Publish to Discover</button>
            <button className="btn primary sm">+ Add version</button>
          </div>
        </div>
      </div>

      {/* Progress timeline — the iteration arc, big */}
      <ProgressTimeline song={song} selected={selected} onSelect={setSelected} onCompare={setCompare} compare={compare} />

      {/* 2-col: Version list + (cross-version delta preview) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 20, marginTop: 20 }}>
        <VersionListCard song={song} selected={selected} onSelect={setSelected} onOpenAnalysis={onOpenAnalysis} compare={compare} onCompare={setCompare} />
        <DeltaCard song={song} selected={selected} compare={compare} />
      </div>
    </div>
  );
}

// ── Progress timeline — large version arc + per-version stats ─────────────

function ProgressTimeline({ song, selected, onSelect, onCompare, compare }) {
  // Build a big version sparkline with markers
  const W = 1300, H = 200;
  const padX = 56, padY = 30;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const minScore = Math.min(...song.versions.map(v => v.score), 30) - 10;
  const maxScore = Math.max(...song.versions.map(v => v.score), 100) + 5;
  const range = maxScore - minScore;
  const toY = s => padY + innerH - ((s - minScore) / range) * innerH;

  const points = song.versions.map((v, i) => {
    const x = song.versions.length === 1
      ? padX + innerW / 2
      : padX + (i / (song.versions.length - 1)) * innerW;
    return { x, y: toY(v.score), v };
  });

  const lineD = points.length > 1
    ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`
    : null;
  const fillD = points.length > 1
    ? `${lineD} L ${points[points.length - 1].x},${H - padY} L ${points[0].x},${H - padY} Z`
    : null;

  return (
    <div className="card" style={{ padding: '18px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <SectionTitle accent="var(--cyan)" style={{ marginBottom: 6 }}>Iteration arc</SectionTitle>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            Click a version to inspect · shift-click to compare two versions
          </span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          score {song.versions[0].score} <span style={{ color: 'var(--cyan)' }}>→ {song.versions[song.versions.length - 1].score}</span>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* horizontal grade-band guides */}
          {[
            { score: 90, label: 'A',  color: 'rgba(52,211,153,0.18)' },
            { score: 80, label: 'A-', color: 'rgba(52,211,153,0.10)' },
            { score: 70, label: 'B',  color: 'rgba(0,229,176,0.08)' },
            { score: 60, label: 'C',  color: 'rgba(251,191,36,0.08)' },
            { score: 50, label: 'D',  color: 'rgba(251,146,60,0.06)' },
          ].map(b => {
            const y = toY(b.score);
            if (y < padY || y > H - padY) return null;
            return (
              <g key={b.score}>
                <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 3" />
                <text x={padX - 8} y={y + 4} fill="rgba(255,255,255,0.20)" fontSize="11" fontFamily="JetBrains Mono, monospace" textAnchor="end">{b.label}</text>
              </g>
            );
          })}
          {fillD && <path d={fillD} fill="var(--cyan)" opacity="0.10" />}
          {lineD && <path d={lineD} stroke="var(--cyan)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(0,229,176,0.5))' }} />}
          {points.map((p, i) => {
            const c = gradeColor(p.v.grade);
            const isSelected = selected === p.v.v;
            const isCompare = compare === p.v.v;
            const isCurrent = p.v.current;
            return (
              <g key={i} style={{ cursor: 'pointer' }} onClick={(e) => {
                if (e.shiftKey) onCompare(p.v.v); else onSelect(p.v.v);
              }}>
                {/* version label above */}
                <text x={p.x} y={p.y - 18} fill={c} fontSize="11" fontWeight="700" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                  v{p.v.v}
                </text>
                {/* score */}
                <text x={p.x} y={p.y - 32} fill={isSelected ? c : 'var(--muted)'} fontSize="10" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                  {p.v.score}
                </text>
                {/* outer ring if selected/compare */}
                {(isSelected || isCompare) && (
                  <circle cx={p.x} cy={p.y} r="11" fill="none" stroke={isCompare ? 'var(--violet)' : 'var(--cyan)'} strokeWidth="2" />
                )}
                {/* dot */}
                <circle cx={p.x} cy={p.y} r="6" fill={c} stroke="#06151a" strokeWidth="2"
                  style={{ filter: `drop-shadow(0 0 6px ${c})` }} />
                {isCurrent && (
                  <circle cx={p.x} cy={p.y + 18} r="3" fill="var(--cyan)" />
                )}
                {/* date below */}
                <text x={p.x} y={p.y + 36} fill="var(--dim)" fontSize="10" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                  {p.v.date}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Version list card ─────────────────────────────────────────────────────

function VersionListCard({ song, selected, onSelect, onOpenAnalysis, compare, onCompare }) {
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--cyan)" style={{ marginBottom: 0 }}>
          Versions · <span style={{ color: 'var(--text-2)' }}>{song.versionCount}</span>
        </SectionTitle>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>newest first</span>
      </div>
      <div style={{ padding: '6px 8px 12px' }}>
        {[...song.versions].reverse().map((v, i, arr) => {
          const prev = arr[i + 1]; // newer to older, so prev in time is at i+1
          return (
            <VersionRow
              key={v.v}
              v={v}
              prev={prev}
              selected={selected === v.v}
              compare={compare === v.v}
              onSelect={() => onSelect(v.v)}
              onCompare={() => onCompare(compare === v.v ? null : v.v)}
              onOpenAnalysis={() => onOpenAnalysis(v.v)}
            />
          );
        })}
      </div>
    </div>
  );
}

function VersionRow({ v, prev, selected, compare, onSelect, onCompare, onOpenAnalysis }) {
  const c = gradeColor(v.grade);
  const scoreDelta = prev ? v.score - prev.score : null;
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 12px',
        borderRadius: 8,
        background: selected ? 'rgba(0,229,176,0.05)' : compare ? 'rgba(167,139,250,0.05)' : 'transparent',
        border: selected ? '1px solid rgba(0,229,176,0.32)' : compare ? '1px solid rgba(167,139,250,0.32)' : '1px solid transparent',
        marginBottom: 4,
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer',
        transition: 'background .15s',
      }}>
      <GradePill grade={v.grade} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>v{v.v}</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{v.label || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>(unlabeled)</span>}</span>
          {v.current && <span className="pill cyan" style={{ fontSize: 9, fontWeight: 700 }}>CURRENT</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
          <span className="mono" style={{ fontSize: 11, color: c, fontWeight: 600 }}>{v.score}<span style={{ color: 'var(--muted)' }}>/100</span></span>
          {scoreDelta != null && (
            <span className="mono" style={{
              fontSize: 10, fontWeight: 700,
              color: scoreDelta > 0 ? 'var(--green)' : scoreDelta < 0 ? 'var(--red)' : 'var(--muted)',
            }}>
              {scoreDelta > 0 ? '+' : ''}{scoreDelta} vs v{prev.v}
            </span>
          )}
          <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>· {v.date}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        <button onClick={(e) => { e.stopPropagation(); onCompare(); }}
          className="btn ghost sm" style={{
            color: compare ? 'var(--violet)' : 'var(--muted)',
            borderColor: compare ? 'rgba(167,139,250,0.40)' : 'var(--border)',
            background: compare ? 'rgba(167,139,250,0.06)' : 'transparent',
            border: '1px solid',
            padding: '4px 9px', fontSize: 11,
          }}>
          {compare ? '× Compare' : '⇄ Compare'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onOpenAnalysis(); }} className="btn sm">Open</button>
      </div>
    </div>
  );
}

// ── Delta card — placeholder for future cross-version diff ────────────────

function DeltaCard({ song, selected, compare }) {
  const selV = song.versions.find(v => v.v === selected);
  const cmpV = song.versions.find(v => v.v === compare);

  if (selV && cmpV) {
    return <ActiveDeltaCard a={cmpV} b={selV} />;
  }

  return (
    <div className="card card-body" style={{ position: 'sticky', top: 80 }}>
      <SectionTitle accent="var(--violet)" right={<span className="pill violet">Beta</span>}>
        Version delta
      </SectionTitle>
      <div style={{
        padding: 16,
        border: '1.5px dashed rgba(167,139,250,0.32)',
        borderRadius: 10,
        background: 'rgba(167,139,250,0.04)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: 'rgba(167,139,250,0.10)',
          border: '1px solid rgba(167,139,250,0.32)',
          margin: '0 auto 12px',
          display: 'grid', placeItems: 'center',
          color: 'var(--violet)', fontSize: 20,
        }}>⇄</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Compare two versions</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 12 }}>
          See exactly what changed between any two versions — LUFS delta, frequency tilt, stereo width, fix-list deltas.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>Tap <span style={{ color: 'var(--violet)' }}>⇄ Compare</span> on two version rows.</span>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
          QUICK SUGGESTIONS
        </div>
        {[
          { from: song.versions[0], to: song.versions[song.versions.length - 1], label: 'First → current' },
          song.versions.length >= 3 && { from: song.versions[song.versions.length - 2], to: song.versions[song.versions.length - 1], label: 'Last two' },
        ].filter(Boolean).map((s, i) => {
          const dlt = s.to.score - s.from.score;
          return (
            <button key={i} className="btn sm" style={{
              width: '100%', justifyContent: 'space-between', marginBottom: 6,
              padding: '8px 12px',
            }}>
              <span>{s.label}</span>
              <span className="mono" style={{ fontSize: 11 }}>
                v{s.from.v} <span style={{ color: 'var(--muted)' }}>→</span> v{s.to.v}
                <span style={{ color: dlt > 0 ? 'var(--green)' : 'var(--red)', marginLeft: 8 }}>{dlt > 0 ? '+' : ''}{dlt}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActiveDeltaCard({ a, b }) {
  // a is the older one, b is the newer one
  const scoreDelta = b.score - a.score;
  // Fabricate delta metrics for the demo
  const metrics = [
    { label: 'Mix score',  a: a.score,   b: b.score,   delta: scoreDelta,           unit: '',     better: 'higher' },
    { label: 'LUFS',       a: -10.2,     b: -11.2,     delta: -1.0,                 unit: ' LUFS',better: 'higher' },
    { label: 'Dyn range',  a: 4.2,       b: 5.4,       delta: +1.2,                 unit: ' LU',  better: 'higher' },
    { label: 'Bass energy',a: 0.92,      b: 0.88,      delta: -0.04,                unit: '',     better: 'lower' },
    { label: 'Air band',   a: 0.28,      b: 0.32,      delta: +0.04,                unit: '',     better: 'higher' },
    { label: 'Width',      a: 58,        b: 62,        delta: +4,                   unit: '%',    better: 'higher' },
  ];
  return (
    <div className="card" style={{ position: 'sticky', top: 80 }}>
      <div className="card-hd">
        <SectionTitle accent="var(--violet)" style={{ marginBottom: 0 }}>
          Delta · v{a.v} <span style={{ color: 'var(--muted)' }}>→</span> v{b.v}
        </SectionTitle>
        <span className="pill violet">Beta</span>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <GradePill grade={a.grade} size="sm" />
            <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>v{a.v} · {a.date}</div>
          </div>
          <div style={{ flex: 0, fontSize: 20, color: 'var(--violet)' }}>→</div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <GradePill grade={b.grade} size="sm" />
            <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>v{b.v} · {b.date}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {metrics.map(m => {
            const positive =
              (m.better === 'higher' && m.delta > 0) ||
              (m.better === 'lower'  && m.delta < 0);
            const negative =
              (m.better === 'higher' && m.delta < 0) ||
              (m.better === 'lower'  && m.delta > 0);
            const col = positive ? 'var(--green)' : negative ? 'var(--red)' : 'var(--muted)';
            const sign = m.delta > 0 ? '+' : '';
            return (
              <div key={m.label} style={{
                display: 'grid', gridTemplateColumns: '1fr 60px 60px 70px',
                alignItems: 'center', gap: 8,
                padding: '6px 0', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{m.label}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                  {typeof m.a === 'number' ? (Math.abs(m.a) < 10 ? m.a.toFixed(2) : m.a.toFixed(1)) : m.a}{m.unit}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text)', textAlign: 'right' }}>
                  {typeof m.b === 'number' ? (Math.abs(m.b) < 10 ? m.b.toFixed(2) : m.b.toFixed(1)) : m.b}{m.unit}
                </span>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: col, textAlign: 'right' }}>
                  {sign}{Math.abs(m.delta) < 10 ? m.delta.toFixed(2) : m.delta.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 14, padding: 12,
          borderRadius: 8,
          background: 'rgba(52,211,153,0.06)',
          border: '1px solid rgba(52,211,153,0.22)',
        }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--green)', textTransform: 'uppercase', marginBottom: 4 }}>VERDICT</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
            v{b.v} traded {Math.abs(metrics[1].delta).toFixed(1)} LU of loudness for {metrics[2].delta.toFixed(1)} LU of dynamic range and a healthier low-end balance. Score went up <span style={{ color: 'var(--green)', fontWeight: 700 }}>{scoreDelta > 0 ? '+' : ''}{scoreDelta}</span>.
          </div>
        </div>

        <button className="btn primary sm" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
          Open full diff →
        </button>
      </div>
    </div>
  );
}

window.LibraryPage = LibraryPage;
window.SongDetailPage = SongDetailPage;
