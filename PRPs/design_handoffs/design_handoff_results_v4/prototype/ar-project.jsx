/* spectre — Analysis Results redesign. Project tab (.als) — conditional on phase 8.
   Project health, track/device clutter, MIDI health, plugin list, arrangement. */

const AR_SECTION_COLORS = {
  Intro: '#8fa5c0', Build: '#ffd166', Breakdown: '#b39df2', Drop: '#5bd0c0',
  'Drop 2': '#9ce37d', Mid: '#6db4f2', Outro: '#8fa5c0',
};

function HealthRing({ score, size = 46 }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const col = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--accent)' : 'var(--orange)';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dim)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: col, lineHeight: 1 }}>{score}</span>
      </div>
    </div>
  );
}

function ArrangementStrip({ sections }) {
  const total = sections.reduce((s, x) => s + x.bars, 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 1, height: 24, overflow: 'hidden', border: '1px solid rgba(0,0,0,.5)' }}>
        {sections.map((s, i) => (
          <div key={i} title={`${s.name} · ${s.bars} bars`} style={{ width: `${(s.bars / total) * 100}%`, background: AR_SECTION_COLORS[s.name] || '#4a5568', display: 'flex', alignItems: 'center', minWidth: 0, borderLeft: i > 0 ? '1px solid rgba(0,0,0,.45)' : 'none' }}>
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(0,0,0,.72)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px' }}>{s.name}</span>
          </div>
        ))}
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9.5, color: 'var(--muted)' }}>
        <span>{sections.length} sections</span><span>{total} bars</span>
      </div>
    </div>
  );
}

function PStat({ k, v, u, warn }) {
  return <div className="pstat"><span className="k">{k}</span><span className="v" style={warn ? { color: 'var(--orange)' } : undefined}><span className="mono">{v}</span>{u && <span className="u">{u}</span>}</span></div>;
}

const AR_TRK_COLORS = ['#c98a5a', '#c9b45a', '#8fb46a', '#5ab0a4', '#5a94c9', '#9d8fc9', '#c97da8', '#b0b06a'];

function ProjectTab({ scenario }) {
  const p = scenario.project;
  if (!p) return null;
  return (
    <div className="tabbody proj fade-up">
      <p className="tab-intro" style={{ marginBottom: 12 }}><b>From your Ableton project.</b> Read directly from <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{scenario.inputs.als.name}</span> — device clutter, MIDI health and arrangement, independent of the audio analysis.</p>

      <div className="proj-grid" style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="card-hd"><span className="t"><span className="led" />Project health</span><span className="meta">{p.version}</span></div>
          <div className="card-body">
            <div className="proj-health">
              <HealthRing score={p.health} />
              <div className="pstats">
                <PStat k="Tempo" v={p.tempo} u="BPM" />
                <PStat k="Time sig" v={p.timeSig} />
                <PStat k="Devices" v={p.totalDevices} u={`${p.disabledDevices} off`} />
                <PStat k="Clutter" v={`${p.clutterPct}%`} warn={p.clutterPct > 12} />
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><span className="t"><span className="led" />Arrangement</span><span className="meta">from .als markers</span></div>
          <div className="card-body"><ArrangementStrip sections={p.arrangement} /></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-hd"><span className="t"><span className="led" />Tracks</span><span className="meta">{p.tracks.length} tracks · device chain order</span></div>
        <div className="card-body">
          <div className="tracks-grid">
            {p.tracks.map((t, i) => (
              <div className="trk-block" key={i} style={{ '--tc': AR_TRK_COLORS[i % AR_TRK_COLORS.length] }}>
                <div className="trk-head">
                  <span className="trk-swatch" />
                  <span className={`trk-n${t.muted ? ' muted' : ''}`}>{t.name}</span>
                  {t.muted && <span className="trk-muted mono">muted</span>}
                  <span className="trk-type mono">{t.type}</span>
                  <span className="trk-count mono">{t.chain.length} dev</span>
                </div>
                <div className="trk-chain">
                  {t.chain.map((d, j) => <span className={`dev-chip${d.off ? ' off' : ''}`} key={j} title={d.off ? 'disabled' : undefined}><span className="dc-led" />{d.n}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {p.midiAnalysis && <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-hd"><span className="t"><span className="led" />MIDI detail — chords &amp; swing</span><span className="meta">phase8.midi_analysis[]</span></div>
        <div className="card-body">
          <div className="ma-rows">
            {p.midiAnalysis.map((row, i) => (
              <div className="ma-row" key={i}>
                <span className="ma-t mono">{row.track}</span>
                <span className="ma-stats mono">swing {row.swing.toFixed(2)} · human {Math.round(row.humanization * 100)}% · {row.density} notes/bar</span>
                <span className="ma-chords">{row.chords.length > 0 ? row.chords.map((c, j) => <span className="ma-chord" key={j} title={c.time}>{c.name}</span>) : <span className="ma-none">no chords</span>}</span>
              </div>
            ))}
          </div>
        </div>
      </div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-hd"><span className="t"><span className="led" />Plugins &amp; devices</span><span className="meta">{p.plugins.length} unique</span></div>
        <div className="card-body"><div className="plugin-chips">{p.plugins.map((pl, i) => <span className="plugin-chip" key={i}>{pl}</span>)}</div></div>
      </div>

      <div className="card">
        <div className="card-hd"><span className="t"><span className="led" />MIDI health</span><span className="meta">{p.midi.humanized ? 'humanized ✓' : 'quantized'}</span></div>
        <div className="card-body">
          <div className="pstats" style={{ marginBottom: 12 }}>
            <PStat k="Notes" v={p.midi.notes.toLocaleString()} />
            <PStat k="Quant issues" v={p.midi.quantIssues} warn={p.midi.quantIssues > 0} />
          </div>
          {p.midiIssues.map((mi, i) => (
            <div className="midi-issue" key={i}>
              <span className="mi-sev" style={{ background: arSevColor(mi.sev) }} />
              <div className="mi-b"><div className="mt"><span className="mono" style={{ color: 'var(--violet)', fontSize: 11 }}>{mi.track}</span></div><div className="mf">{mi.text}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ProjectTab });
