/* spectre — Analysis Results redesign. Persistent frame:
   top bar (scaffold) · header card · tiny player · tab bar · sidebar. */
const { useState: useStateFr, useEffect: useEffectFr, useRef: useRefFr } = React;

// ── Top bar — mock SPECTR chrome (scaffold, not the deliverable) ─────
function TopBar({ credits, track }) {
  return (
    <div className="topbar">
      <div className="tb-brand"><BrandMark /><span className="tb-name">spectre</span></div>
      <nav className="tb-nav">
        <a href="#">Library</a><a href="#">Compare</a><a href="#" className="on">Analyze</a><a href="#">Listen</a>
      </nav>
      <span className="tb-spacer" />
      <span className="tb-credits"><span className="v">{credits}</span> credits</span>
      <span className="tb-avatar">M</span>
    </div>
  );
}

// ── Input chips (what the analysis ran on) ───────────────────────────
function InputChips({ inputs, onAdd }) {
  const refLabel = inputs.ref?.meta === 'profile' ? 'Reference profile' : 'Reference track';
  const defs = [
    { key: 'mix', label: 'Primary mix', add: 'mix' },
    { key: 'stems', label: 'Stems', add: 'stems' },
    { key: 'als', label: 'Ableton project', add: '.als' },
    { key: 'ref', label: refLabel, add: 'reference' },
  ];
  return (
    <div className="rh-chips">
      <span className="rh-chips-label">Analyzed from</span>
      {defs.map(d => {
        const on = inputs[d.key]?.on;
        if (on) return <span key={d.key} className="chip on"><Icon name="check" size={11} />{d.label}</span>;
        return <button key={d.key} className="chip add" onClick={() => onAdd(d.key)} title={`Add ${d.add}`}><span className="pl">+</span>Add {d.add}</button>;
      })}
    </div>
  );
}

// ── Findings vital (the single header stat) ──────────────────────────
function FindingsVital({ findings }) {
  const faults = findings.filter(f => f.sev !== 'win' && f.kind !== 'integrity');
  const n = faults.length;
  const m = findings.filter(f => f.fixId).length;
  const worst = arWorstSev(findings);
  if (n === 0) {
    return (
      <div className="rh-vital clean">
        <div className="vtxt"><span className="vn">No issues</span><span className="vs">clean mix</span></div>
      </div>
    );
  }
  return (
    <div className="rh-vital">
      <div className="vtxt">
        <span className="vn"><span className="num">{n}</span> {n === 1 ? 'finding' : 'findings'}</span>
        <span className="vs"><span className="fx">{m}</span> {m === 1 ? 'suggestion' : 'suggestions'}</span>
      </div>
    </div>
  );
}

// ── Tiny inline player — mocked transport, persists across tabs ───────
function Player({ scenario }) {
  const dur = scenario.track.durationSec;
  const storeKey = `ar:player:${scenario.id}`;
  const [pos, setPos] = useStateFr(() => {
    try { const v = JSON.parse(localStorage.getItem(storeKey) || 'null'); return v && typeof v.pos === 'number' ? Math.min(v.pos, dur) : 0; } catch { return 0; }
  });
  const [playing, setPlaying] = useStateFr(false);
  const waveRef = useRefFr(null);
  const posRef = useRefFr(pos); posRef.current = pos;

  // advance while playing
  useEffectFr(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      let next = posRef.current + dt;
      if (next >= dur) { next = dur; setPlaying(false); }
      setPos(next);
      if (next < dur) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur]);

  // persist
  useEffectFr(() => {
    try { localStorage.setItem(storeKey, JSON.stringify({ pos, playing })); } catch {}
  }, [pos, playing, storeKey]);

  // reset on scenario change handled by key remount (see frame usage)
  const seek = (e) => {
    const el = waveRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setPos(frac * dur);
  };
  const onDown = (e) => {
    seek(e);
    const move = (ev) => seek(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const NB = 132;
  const frac = pos / dur;
  const bars = useRefFr(Array.from({ length: NB }, (_, i) =>
    0.18 + Math.abs(Math.sin(i * 0.5) * 0.5 + Math.sin(i * 1.3 + 1) * 0.32 + Math.sin(i * 0.21) * 0.2))).current;

  return (
    <div className="player">
      <button className="pl-btn" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>
      <div className="pl-wave" ref={waveRef} onPointerDown={onDown}>
        {bars.map((v, i) => <i key={i} className={i / NB <= frac ? 'on' : ''} style={{ height: `${Math.min(100, v * 100)}%` }} />)}
      </div>
      <span className="pl-time"><span>{arFmtTime(pos)}</span><span className="sep">/</span><span className="tot">{scenario.track.duration}</span></span>
    </div>
  );
}

// ── Header card (persistent across tabs) ─────────────────────────────
function ResultsHeader({ scenario, onVitalClick, onAddInput }) {
  return (
    <div className="rhead">
      <div className="rh-top">
        <CoverArt hue={scenario.track.hue} size={62} badge={scenario.track.version} />
        <div className="rh-titles">
          <div className="rh-titlerow">
            <span className="rh-name">{scenario.track.name}</span>
            <span className="rh-ver">{scenario.track.version}</span>
          </div>
          {scenario.meta && scenario.meta.genre && scenario.meta.genre !== 'other' && (
            <div className="rh-genre">{scenario.meta.genre.charAt(0).toUpperCase() + scenario.meta.genre.slice(1)}</div>
          )}
          <InputChips inputs={scenario.inputs} onAdd={onAddInput} />
        </div>
        <FindingsVital findings={scenario.findings} />
      </div>
      <Player key={scenario.id} scenario={scenario} />
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────
function TabBar({ tab, setTab, tabs }) {
  return (
    <div className="rtabs">
      {tabs.map(tb => (
        <button key={tb.id} className={`rtab${tab === tb.id ? ' active' : ''}${tb.alert ? ' alert' : ''}`} onClick={() => setTab(tb.id)}>
          <span className="ic"><Icon name={tb.icon} size={15} /></span>
          {tb.label}
          {tb.badge != null && tb.badge > 0 && <span className="rtab-badge">{tb.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Sidebar (Uploads + Re-analyze) ───────────────────────────────────
function Sidebar({ scenario, onAddInput, onReanalyze }) {
  const rows = [
    { key: 'mix', label: 'Mix / master', tag: 'WAV' },
    { key: 'stems', label: 'Stems', tag: 'STM' },
    { key: 'als', label: 'Ableton project', tag: 'ALS' },
    { key: 'ref', label: 'Reference', tag: 'REF' },
  ];
  return (
    <aside className="side">
      <div className="side-card">
        <div className="side-h"><span className="l">Uploads</span><span className="hint">{Object.values(scenario.inputs).filter(i => i.on).length}/4</span></div>
        <div className="side-body">
          {rows.map(r => {
            const inp = scenario.inputs[r.key];
            if (inp?.on) return (
              <div key={r.key} className="up-row">
                <span className="up-ic">{r.tag}</span>
                <div className="up-b"><div className="ul">{r.label}</div><div className="un">{inp.name}</div></div>
                {inp.meta && <span className="up-meta">{inp.meta}</span>}
              </div>
            );
            return (
              <button key={r.key} className="up-row empty" onClick={() => onAddInput(r.key)}>
                <span className="up-ic">{r.tag}</span>
                <div className="up-b"><div className="ul">{r.label}</div><div className="un">Add to deepen analysis</div></div>
                <span className="up-add">+</span>
              </button>
            );
          })}
        </div>
      </div>
      <button className="reanalyze" onClick={onReanalyze}><Icon name="refresh" size={14} />Re-analyze</button>
      <p className="side-note">Adding stems or your .als unlocks per-stem clash detection and project health checks.</p>
    </aside>
  );
}

Object.assign(window, { TopBar, InputChips, FindingsVital, Player, ResultsHeader, TabBar, Sidebar });
