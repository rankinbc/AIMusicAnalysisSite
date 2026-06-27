/* spectre — Analysis Results redesign. Project tab (.als) — conditional on phase 8.
   Project health, track/device clutter, MIDI health, plugin list, arrangement. */

const AR_SECTION_COLORS = {
  Intro: '#3a4a63', Build: '#5b6e8c', Breakdown: '#7c5ea8', Drop: '#00e5b0',
  'Drop 2': '#00f3bd', Mid: '#a78bfa', Outro: '#4a5568',
};

function HealthRing({ score, size = 76 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const col = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--accent)' : 'var(--orange)';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dim)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', flexDirection: 'column' }}>
        <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: col, lineHeight: 1 }}>{score}</span>
      </div>
    </div>
  );
}

function ArrangementStrip({ sections }) {
  const total = sections.reduce((s, x) => s + x.bars, 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 38, borderRadius: 6, overflow: 'hidden' }}>
        {sections.map((s, i) => (
          <div key={i} title={`${s.name} · ${s.bars} bars`} style={{ width: `${(s.bars / total) * 100}%`, background: AR_SECTION_COLORS[s.name] || '#4a5568', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(255,255,255,.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px' }}>{s.name}</span>
          </div>
        ))}
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 9.5, color: 'var(--muted)' }}>
        <span>{sections.length} sections</span><span>{total} bars</span>
      </div>
    </div>
  );
}

function ProjectTab({ scenario }) {
  const p = scenario.project;
  if (!p) return null;
  return (
    <div className="tabbody fade-up">
      <p className="tab-intro"><b>From your Ableton project.</b> Read directly from <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{scenario.inputs.als.name}</span> — device clutter, MIDI health and arrangement, independent of the audio analysis.</p>

      <div className="proj-grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-hd"><span className="t"><span className="led" />Project health</span><span className="meta">{p.version}</span></div>
          <div className="card-body">
            <div className="proj-health">
              <HealthRing score={p.health} />
              <div style={{ flex: 1 }}>
                <div className="meta-row" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="mstat" style={{ padding: '10px 12px' }}><div className="ml">Tempo</div><div className="mv" style={{ fontSize: 15 }}><span className="mono">{p.tempo}</span><span className="u">BPM</span></div></div>
                  <div className="mstat" style={{ padding: '10px 12px' }}><div className="ml">Time sig</div><div className="mv" style={{ fontSize: 15 }}><span className="mono">{p.timeSig}</span></div></div>
                  <div className="mstat" style={{ padding: '10px 12px' }}><div className="ml">Devices</div><div className="mv" style={{ fontSize: 15 }}><span className="mono">{p.totalDevices}</span><span className="u">{p.disabledDevices} off</span></div></div>
                  <div className="mstat" style={{ padding: '10px 12px' }}><div className="ml">Clutter</div><div className="mv" style={{ fontSize: 15, color: p.clutterPct > 12 ? 'var(--orange)' : 'var(--text)' }}><span className="mono">{p.clutterPct}%</span></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><span className="t"><span className="led" />Arrangement</span><span className="meta">from .als markers</span></div>
          <div className="card-body"><ArrangementStrip sections={p.arrangement} /></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-hd"><span className="t"><span className="led" />Tracks</span><span className="meta">{p.tracks.length} tracks · device chain order</span></div>
        <div className="card-body">
          <div className="tracks-grid">
            {p.tracks.map((t, i) => (
              <div className="trk-block" key={i}>
                <div className="trk-head">
                  <span className="trk-dot" style={{ background: t.type === 'midi' ? 'var(--violet)' : 'var(--accent)' }} />
                  <span className={`trk-n${t.muted ? ' muted' : ''}`}>{t.name}</span>
                  <span className="trk-type mono">{t.type}</span>
                  <span className="trk-count mono">{t.chain.length} dev</span>
                </div>
                <div className="trk-chain">
                  {t.chain.map((d, j) => <span className={`dev-chip${d.off ? ' off' : ''}`} key={j} title={d.off ? 'disabled' : undefined}>{d.n}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-hd"><span className="t"><span className="led" />Plugins &amp; devices</span><span className="meta">{p.plugins.length} unique</span></div>
        <div className="card-body"><div className="plugin-chips">{p.plugins.map((pl, i) => <span className="plugin-chip" key={i}>{pl}</span>)}</div></div>
      </div>

      <div className="card">
        <div className="card-hd"><span className="t"><span className="led" />MIDI health</span><span className="meta">{p.midi.humanized ? 'humanized ✓' : 'quantized'}</span></div>
        <div className="card-body">
          <div className="meta-row" style={{ gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14, maxWidth: 360 }}>
            <div className="mstat" style={{ padding: '10px 12px' }}><div className="ml">Notes</div><div className="mv" style={{ fontSize: 15 }}><span className="mono">{p.midi.notes.toLocaleString()}</span></div></div>
            <div className="mstat" style={{ padding: '10px 12px' }}><div className="ml">Quant issues</div><div className="mv" style={{ fontSize: 15, color: p.midi.quantIssues > 0 ? 'var(--orange)' : 'var(--text)' }}><span className="mono">{p.midi.quantIssues}</span></div></div>
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
