/* spectre — Listen Rack redesign. Shell: slim header + stage frame + tab routing + tweaks.
   TopBar / toast host / Tweaks panel are prototype scaffold (see CLAUDE.md), not the deliverable. */
const { useState: aS, useEffect: aE, useCallback: aC, useMemo: aM, useRef: aR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "stageHeight": 210,
  "stageMeters": true,
  "notePins": true,
  "sidebar": true,
  "stickyToolbar": true,
  "showBind": false,
  "workletFlag": true,
  "lightShow": true,
  "fxIntensity": 1,
  "glassPanels": true
}/*EDITMODE-END*/;

// ── Scaffold: mock SPECTR chrome ───────────────────────────────────────
function TopBar() {
  return (
    <div className="topbar">
      <div className="tb-brand"><BrandMark /><span className="tb-name">SPECTR</span></div>
      <nav className="tb-nav"><a href="#">Library</a><a href="#">Songs</a><a href="#" className="on">Listen</a><a href="#">Coach</a></nav>
      <span className="tb-spacer" />
      <span className="tb-credits">Credits <span className="v">128</span></span>
      <span className="tb-avatar">M</span>
    </div>);
}
function ToastHost({ toast }) {
  if (!toast) return null;
  return (
    <div style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 15px', borderRadius: 10, background: 'var(--surface)', border: '1px solid rgba(0,229,176,.35)', boxShadow: '0 18px 40px -18px rgba(0,0,0,.9)', animation: 'fadeUp .2s ease both' }}>
      <span style={{ color: 'var(--accent)', display: 'grid' }}><Icon name="check" size={14} /></span>
      <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{toast.title}</span>
      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{toast.sub}</span>
    </div>);
}

// ── Deliverable: slim header row ───────────────────────────────────────
function Header({ meters, rack, playing }) {
  const t = TRACK;
  const active = rack.order.filter((id) => rack.mod[id].enabled).length;
  return (
    <div className="lr-head">
      <span className="cov"><CoverArt hue={168} size={38} radius={9} /></span>
      <span className="lr-htitle">
        <span className="n">{t.name}</span>
        <span className="lr-stats">
          <span className="lr-live"><i />{playing ? 'LISTENING' : 'PAUSED'}</span>
          <b>{t.bpm}</b> BPM<span className="sep">·</span><b>{t.key}</b><span className="sep">·</span>{lrTime(t.durationSec)}
          <span className="lo"><span className="sep">·</span>{t.format}</span>
          <span className="sep">·</span><b>{meters.lufs.toFixed(1)}</b> LUFS<span className="sep">·</span><b>{meters.tp.toFixed(1)}</b> dBTP
          <span className="md"><span className="sep">·</span>grade <span className="ac">{t.grade}</span></span>
          <span className="lo"><span className="sep">·</span>
            <span className="ac">{rack.bypass ? 'chain bypassed' : active + ' modules on'}</span>
          </span>
        </span>
      </span>
      <span className="sp" />
      <button className="btn sm ghost" title="Share this session"><Icon name="users" size={13} />Invite</button>
      <button className="btn sm primary">View report<Icon name="arrow" size={13} /></button>
    </div>);
}

const LR_TABS = [['rack', 'Rack', 'sliders'], ['visuals', 'Visuals', 'sparkle'], ['coach', 'Coach', 'robot']];

function App() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = aS('rack');
  const [playing, setPlaying] = aS(true);
  const [position, setPosition] = aS(42);
  const [sel, setSel] = aS('comp');
  const [stages, setStages] = aS(['eq', 'radial']);
  const [director, setDirector] = aS('off');
  const [activeNote, setActiveNote] = aS(null);
  const [myStatus, setMyStatus] = aS('🎧');
  const [toast, setToast] = aS(null);
  const rack = useRack();
  const meters = useMeters(playing, rack.mod, rack.bypass);

  const posRef = aR(position); posRef.current = position;
  aE(() => {
    if (!playing) return;
    let raf, t0 = performance.now(), p0 = posRef.current;
    const f = () => {
      const p = p0 + (performance.now() - t0) / 1000;
      if (p >= TRACK.durationSec) { setPosition(0); setPlaying(false); return; }
      setPosition(p); raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  aE(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id); }, [toast]);

  const section = aM(() => {
    const secs = TRACK.arrangement.sections, total = secs.reduce((s, x) => s + x.bars, 0);
    let acc = 0; const pct = position / TRACK.durationSec;
    for (const s of secs) { const w = s.bars / total; if (pct >= acc && pct < acc + w) return s.l; acc += w; }
    return secs[0].l;
  }, [position]);
  const onApply = aC((p) => setToast({ title: p.title, sub: p.fix || p.move }), []);
  const onNote = aC((n) => { setActiveNote(n.id); setPosition(n.t); }, []);
  const toggleStage = aC((id) => setStages((s) => s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]), []);
  const activeCount = rack.order.filter((id) => rack.mod[id].enabled).length;

  return (
    <div className={'app' + (tw.glassPanels ? ' lr-glass' : '')} data-screen-label="Listen — rack">
      <LightShow playing={playing} intensity={tw.fxIntensity} show={tw.lightShow} />
      <TopBar />
      <div className="wrap" data-density="dense">
        <a className="backlink" href="#"><Icon name="back" size={14} />all versions</a>
        <Header meters={meters} rack={rack} playing={playing} />
        <StageCard playing={playing} onPlay={() => setPlaying((p) => !p)} position={position} onSeek={setPosition}
          rack={rack} meters={meters} tw={tw} notes={TRACK.notes} activeNote={activeNote} onNote={onNote} section={section} />
        <div className="rtabs" style={{ marginTop: 12 }}>
          {LR_TABS.map(([id, label, icon]) =>
            <button key={id} className={'rtab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
              <span className="ic"><Icon name={icon} size={14} /></span>{label}
              {id === 'rack' && <span className="rtab-badge">{activeCount}</span>}
              {id === 'coach' && <span className="rtab-badge">{COACH_SUGGESTIONS.length}</span>}
            </button>)}
        </div>
        <div className="tabbody">
          <div className={'lr-layout' + (tw.sidebar ? '' : ' solo')} style={{ marginTop: 0 }}>
            <div style={{ minWidth: 0 }}>
              {tab === 'rack' && <RackTab rack={rack} meters={meters} tw={tw} sel={sel} setSel={setSel} />}
              {tab === 'visuals' && <VisualsTab stages={stages} toggleStage={toggleStage} director={director} setDirector={setDirector} />}
              {tab === 'coach' && <CoachTab rack={rack} onApply={onApply} />}
            </div>
            {tw.sidebar && <Sidebar rack={rack} meters={meters} sel={sel} setSel={setSel} onApply={onApply} tw={tw}
              activeNote={activeNote} onNote={onNote} myStatus={myStatus} setMyStatus={setMyStatus} />}
          </div>
        </div>
      </div>
      <ToastHost toast={toast} />
      <LRTweaks tw={tw} setTweak={setTweak} />
    </div>);
}

function LRTweaks({ tw, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Atmosphere" />
      <TweakToggle label="Light show background" value={tw.lightShow} onChange={(v) => setTweak('lightShow', v)} />
      <TweakSlider label="FX intensity" value={tw.fxIntensity} min={0.3} max={1.8} step={0.1} onChange={(v) => setTweak('fxIntensity', v)} />
      <TweakToggle label="Glass panels" value={tw.glassPanels} onChange={(v) => setTweak('glassPanels', v)} />
      <TweakSection label="Stage" />
      <TweakSlider label="Stage height" value={tw.stageHeight} min={120} max={400} step={10} unit="px" onChange={(v) => setTweak('stageHeight', v)} />
      <TweakToggle label="Overlay meters" value={tw.stageMeters} onChange={(v) => setTweak('stageMeters', v)} />
      <TweakToggle label="Note pins on scrubber" value={tw.notePins} onChange={(v) => setTweak('notePins', v)} />
      <TweakSection label="Optional elements" />
      <TweakToggle label="Right sidebar" value={tw.sidebar} onChange={(v) => setTweak('sidebar', v)} />
      <TweakToggle label="Sticky toolbar" value={tw.stickyToolbar} onChange={(v) => setTweak('stickyToolbar', v)} />
      <TweakToggle label="Worklet flag on cards" value={tw.workletFlag} onChange={(v) => setTweak('workletFlag', v)} />
      <TweakToggle label="Show handle bindings" value={tw.showBind} onChange={(v) => setTweak('showBind', v)} />
    </TweaksPanel>);
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
