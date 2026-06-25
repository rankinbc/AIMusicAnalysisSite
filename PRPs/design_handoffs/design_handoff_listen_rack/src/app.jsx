/* SPECTR · Listen rack redesign — app shell + orchestration
 * Viz-dominant layout: big stage (host-driven, auto modes) + collapsible visual
 * meters overlay, rich rack below, everything else in the right tab panel.
 */
const { useState: useA, useEffect: useAE, useRef: useAR, useMemo: useAM, useCallback: useAC } = React;

function TopNav() {
  return (
    <div className="topnav">
      <div className="brand"><span className="mark"><BrandMark size={14} /></span>SPECTR</div>
      <div className="nav-tabs">
        <button>Report</button><button className="active">Listen</button><button>Library</button>
      </div>
      <div className="nav-right">
        <div className="nav-search"><span style={{ color: 'var(--muted)', fontSize: 12 }}>⌕</span><input placeholder="Search tracks, notes" /></div>
        <button className="nav-icon-btn">◔</button>
        <button className="btn primary sm">+ Upload</button>
        <div className="nav-avatar">M</div>
      </div>
    </div>);

}

function TrackHeader({ mode, setMode }) {
  const t = TRACK;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
      <CoverArt hue={168} size="md" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', letterSpacing: '0.14em' }}>NOW PLAYING</span>
          <span className="dot" style={{ animation: 'pulseGlow 1.6s ease-in-out infinite' }} />
        </div>
        <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.015em', margin: '0 0 3px' }}>{t.name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <Avatar handle={t.author} hue={168} size={20} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>by {t.author}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{t.handle}</span>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill cyan">{t.genre.name}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        <SegBar value={mode} onChange={setMode} options={[{ id: 'solo', label: 'SOLO' }, { id: 'room', label: 'ROOM' }]} accent={mode === 'room' ? 'var(--violet)' : 'var(--cyan)'} />
        <button className="btn primary sm">View Report →</button>
      </div>
    </div>);

}

function PresencePops({ items }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 8 }}>
      {items.map((p) =>
      <div key={p.id} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, animation: 'presencePop 2.7s cubic-bezier(.2,.8,.2,1) forwards' }}>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            <span style={{ position: 'absolute', width: 44, height: 44, borderRadius: '50%', border: `2px solid ${p.ring}`, animation: 'ringPulse 1.1s ease-out forwards' }} />
            <Avatar handle={p.handle} hue={p.hue} anon={p.anon} size={40} ring />
            <span style={{ position: 'absolute', bottom: -8, right: -10, fontSize: 20, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }}>{p.emoji}</span>
          </div>
          <div className="mono" style={{ textAlign: 'center', marginTop: 6, fontSize: 9, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' }}>{p.anon ? 'anon' : '@' + p.handle}</div>
        </div>
      )}
    </div>);

}

// Coach "Applied" announcement — streamed (typed) text + background flash
function CoachToast({ msg }) {
  const [shown, setShown] = React.useState('');
  React.useEffect(() => {
    if (!msg) {setShown('');return;}
    setShown('');let i = 0;
    const iv = setInterval(() => {i++;setShown(msg.text.slice(0, i));if (i >= msg.text.length) clearInterval(iv);}, 20);
    return () => clearInterval(iv);
  }, [msg]);
  if (!msg) return null;
  return (
    <React.Fragment>
      <div key={msg.id + 'f'} className="coach-flash" />
      <div key={msg.id} className="coach-toast">
        <CoachBot size={34} thinking />
        <div>
          <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--cyan)', fontWeight: 700, marginBottom: 2 }}>{msg.title || 'COACH'}</div>
          <div className="coach-stream">{shown}<span className="coach-caret" /></div>
        </div>
      </div>
    </React.Fragment>);

}

function App() {
  const [playing, setPlaying] = useA(true);
  const [position, setPosition] = useA(42);
  const [mode, setMode] = useA('solo');
  const [ia, setIa] = useA('inline');
  const [studioOpen, setStudioOpen] = useA(true);
  const [director, setDirector] = useA('off');
  const [viz, setViz] = useA({ barColor: 'var(--cyan)', laserOn: true, laserEffect: 'beat', laserPattern: 'fan', laserIntensity: 60, laserMono: false, laserColor: '#00e5b0', dropFx: true, autoColor: false, energy: 50, bg: '#00e5b0', bgAuto: false, specHue: 165, bgHue: 165, laserHue: 165, laserBeams: 13, laserSpeed: 1, laserMove: false, laserFlash: true, bgFlash: false, bgFlashHz: 2, bgFlashColor: '#ffffff', laserSync: false, bgSync: false, autoReact: false, autoReactSens: 0.55, theme: ['#00e5b0', '#a78bfa', '#fb923c'] });
  const [stages, setStages] = useA(['eq']);
  const toggleStage = useAC((id) => setStages((s) => s.includes(id) ? s.length > 1 ? s.filter((x) => x !== id) : s : [...s, id]), []);
  const [activeNote, setActiveNote] = useA(null);
  const [pops, setPops] = useA([]);
  const [feed, setFeed] = useA([]);
  const [metersOpen, setMetersOpen] = useA(true);
  const [announcement, setAnnouncement] = useA(null);
  const [myStatus, setMyStatus] = useA('🎧');
  const [rackController, setRackController] = useA(null);
  const [visualController, setVisualController] = useA(null);
  const [bottomView, setBottomView] = useA('rack');
  const [vizPresets, setVizPresets] = useA([]);
  const saveVizPreset = useAC(() => setVizPresets((p) => [...p, { id: Math.random().toString(36).slice(2), name: 'Look ' + (p.length + 1), viz, stages: [...stages], director }]), [viz, stages, director]);
  const recallVizPreset = useAC((p) => {setViz(p.viz);setStages([...p.stages]);setDirector(p.director);}, []);
  const randomizeViz = useAC(() => {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const hues = [165, 280, 30, 210, 320, 100, 50];
    const cs = ['eq', 'devices', 'radial', 'orbit', 'bloom', 'smoke', 'spectro', 'lights'];
    const st = [];const n = 1 + Math.floor(Math.random() * 2);while (st.length < n) {const s = pick(cs);if (!st.includes(s)) st.push(s);}
    setStages(st);
    setViz((v) => ({ ...v, barColor: hslToHex(pick(hues)), bg: hslToHex(pick(hues)), laserEffect: pick(LASER_EFFECTS), laserPattern: pick(LASER_PATTERNS), laserMove: Math.random() < 0.5, laserMono: Math.random() < 0.4, laserColor: hslToHex(pick(hues)), bgFlash: Math.random() < 0.4, bgFlashHz: 1 + Math.floor(Math.random() * 5), bgFlashColor: hslToHex(pick(hues)) }));
  }, []);
  const rs = useRackState();

  const directorObj = useAM(() => DIRECTORS.find((d) => d.id === director), [director]);
  const activeModules = useAM(() => rs.order.filter((id) => rs.mod[id].enabled).map((id) => MANIFEST_BY_ID[id]), [rs.order, rs.mod]);
  const posRef = useAR(position);posRef.current = position;
  const modeRef = useAR(mode);modeRef.current = mode;
  const announce = useAC((text, title) => setAnnouncement({ id: Math.random().toString(36).slice(2), text, title }), []);
  const grantControl = useAC((h, scope) => {
    if (scope === 'visuals') {setVisualController(h);announce(`@${h} can now control the visuals`, 'VISUALS CONTROL');} else
    {setRackController(h);announce(`@${h} can now control the rack`, 'RACK CONTROL');}
  }, [announce]);
  const chooseDirector = useAC((id) => {
    setDirector(id);
    const d = DIRECTORS.find((x) => x.id === id);
    if (d && d.apply && !d.behaviorOnly) setViz((s) => ({ ...s, ...d.apply }));
  }, []);

  useAE(() => {
    if (!playing) return;
    let raf,start = performance.now(),p0 = posRef.current;
    const f = () => {const p = p0 + (performance.now() - start) / 1000;if (p >= TRACK.durationSec) {setPosition(0);setPlaying(false);return;}setPosition(p);raf = requestAnimationFrame(f);};
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useAE(() => {if (mode === 'room' && director === 'off') chooseDirector('club');}, [mode]);

  const currentSection = useAM(() => {
    const total = TRACK.arrangement.sections.reduce((s, x) => s + x.bars, 0);
    let acc = 0;const pct = position / TRACK.durationSec;
    for (const sec of TRACK.arrangement.sections) {const w = sec.bars / total;if (pct >= acc && pct < acc + w) return sec.l;acc += w;}
    return TRACK.arrangement.sections[0].l;
  }, [position]);

  const spawnPresence = useAC((listener, emoji) => {
    const id = Math.random().toString(36).slice(2);
    const x = 8 + Math.random() * 80,y = 24 + Math.random() * 46;
    setPops((p) => [...p, { id, handle: listener.handle, hue: listener.hue, anon: listener.anon, emoji, x, y, ring: `oklch(0.72 0.16 ${listener.hue || 168})` }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 2700);
  }, []);
  const spawnReaction = useAC((emoji, handle) => {
    const u = ROOM_LISTENERS.find((x) => x.handle === handle) || ROOM_LISTENERS[0];
    spawnPresence(u, emoji);
    setFeed((f) => [{ id: Math.random().toString(36).slice(2), emoji, handle: u.handle, text: '', t: Math.floor(posRef.current), you: u.you }, ...f].slice(0, 14));
  }, [spawnPresence]);
  // drop moment in a room: a wave of listeners pop on the stage with fire
  const handleDrop = useAC(() => {
    if (modeRef.current !== 'room') return;
    ROOM_LISTENERS.filter(() => Math.random() < 0.75).forEach((u, i) => setTimeout(() => spawnPresence(u, '🔥'), i * 130));
  }, [spawnPresence]);

  useAE(() => {
    if (!playing || mode !== 'room') return;
    const iv = setInterval(() => {
      if (Math.random() < 0.6) {
        const u = ROOM_LISTENERS[1 + Math.floor(Math.random() * (ROOM_LISTENERS.length - 1))];
        spawnReaction(REACTION_EMOJI[Math.floor(Math.random() * REACTION_EMOJI.length)], u.handle);
      }
    }, 2800);
    return () => clearInterval(iv);
  }, [playing, mode, spawnReaction]);

  useAE(() => {if (!announcement) return;const t = setTimeout(() => setAnnouncement(null), 4800);return () => clearTimeout(t);}, [announcement]);

  const eqOn = rs.mod.eq.enabled && !rs.masterBypass;

  return (
    <div className="app-shell" data-screen-label="Listen — rack redesign">
      <TopNav />
      <div style={{ maxWidth: 1640, margin: '0 auto', padding: '20px 28px 64px', width: '100%' }}>
        <TrackHeader mode={mode} setMode={setMode} />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 348px', gap: 18, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
              <PresencePops items={pops} />
              <VisualMeters track={TRACK} playing={playing} open={metersOpen} setOpen={setMetersOpen} />
              <VizStage playing={playing} stages={stages} setStages={setStages} viz={viz} setViz={setViz}
              director={directorObj} eqBands={rs.mod.eq.bands} eqOn={eqOn} sectionLabel={currentSection} height={440} onDrop={handleDrop} myStatus={myStatus} activeModules={activeModules} />
              <CoachToast msg={announcement} />
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <Transport track={TRACK} playing={playing} position={position} onTogglePlay={() => setPlaying((p) => !p)}
                onSeek={setPosition} notes={TRACK.notes} onNoteClick={(n) => {setActiveNote(n.id);setPosition(n.t);}} activeNote={activeNote} reactions={feed} />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => setBottomView('rack')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'rack' ? '#06151a' : 'var(--muted)', background: bottomView === 'rack' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'rack' ? 'transparent' : 'var(--border)') }}>▦ RACK</button>
                <button onClick={() => setBottomView('lights')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'lights' ? '#06151a' : 'var(--muted)', background: bottomView === 'lights' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'lights' ? 'transparent' : 'var(--border)') }}>☀ VISUALS</button>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select value="" onChange={(e) => {const list = bottomView === 'rack' ? rs.presets : vizPresets;const p = list.find((x) => x.id === e.target.value);if (p) (bottomView === 'rack' ? rs.recallPreset : recallVizPreset)(p);}} className="mono" style={{ fontSize: 10, background: 'var(--card-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px' }}>
                    <option value="">Presets ({(bottomView === 'rack' ? rs.presets : vizPresets).length})</option>
                    {(bottomView === 'rack' ? rs.presets : vizPresets).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button onClick={() => bottomView === 'rack' ? rs.savePreset(rackController || 'you') : saveVizPreset()} className="btn sm primary" style={{ fontSize: 10.5 }}>+ Save preset</button>
                  {(() => {const ac = bottomView === 'rack' ? rackController : visualController;if (!ac) return null;const u = ROOM_LISTENERS.find((x) => x.handle === ac) || {};return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.4)' }}>
                      <Avatar handle={ac} hue={u.hue || 220} anon={u.anon} size={20} />
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--violet)' }}>{bottomView === 'rack' ? 'rack' : 'visuals'} · @{ac}</span>
                    </div>);})()}
                </div>
              </div>
              {bottomView === 'rack' && ia === 'inline' && <InlineRack rs={rs} playing={playing} controller={rackController} />}
              {bottomView === 'rack' && ia === 'console' && <ConsoleRack rs={rs} playing={playing} />}
              {bottomView === 'rack' && ia === 'studio' && <StudioRack rs={rs} playing={playing} open={studioOpen} setOpen={setStudioOpen} />}
              {bottomView === 'lights' && <VisualsPanel stages={stages} toggleStage={toggleStage} director={director} setDirector={chooseDirector} viz={viz} setViz={setViz} onRandomize={randomizeViz} />}
            </div>
          </div>

          <RightRail mode={mode} stages={stages} toggleStage={toggleStage} director={director} setDirector={setDirector}
          viz={viz} setViz={setViz} rs={rs} track={TRACK} playing={playing} position={position}
          activeNote={activeNote} onNoteClick={(n) => {setActiveNote(n.id);setPosition(n.t);}}
          onReact={(e) => {setMyStatus(e);spawnReaction(e, 'maek');}} feed={feed} announce={announce} myStatus={myStatus} rackController={rackController} visualController={visualController} onGrant={grantControl} />
        </div>
      </div>

      <RedesignTweaks {...{ ia, setIa, mode, setMode, rs }} />
    </div>);

}

function RedesignTweaks({ ia, setIa, mode, setMode, rs }) {
  return (
    <TweaksPanel>
      <TweakSection label="Rack layout" />
      <TweakRadio label="Layout" value={ia} options={['inline', 'console', 'studio']} onChange={setIa} />
      <TweakRadio label="Mode" value={mode} options={['solo', 'room']} onChange={setMode} />
      <TweakToggle label="Show handle bindings" value={rs.showBind} onChange={rs.setShowBind} />
    </TweaksPanel>);

}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);