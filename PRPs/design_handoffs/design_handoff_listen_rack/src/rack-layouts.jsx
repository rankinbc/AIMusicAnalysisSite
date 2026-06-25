/* SPECTR · Listen rack redesign — the 3 IA directions
 * A Pedalboard · B Console · C Studio Drawer. All bind to the same rack state.
 */
const { useState: useRL } = React;

// ════════════════════════════════════════════════════════════════════════
// shared pieces
// ════════════════════════════════════════════════════════════════════════
function PedalCard({ id, rs, playing, onOpen, reorder, draggable }) {
  const m = MANIFEST_BY_ID[id],st = rs.mod[id],on = st.enabled && !rs.masterBypass;
  const open = rs.selected === id;
  return (
    <div data-chip style={{ flexShrink: 0, width: 158, borderRadius: 10, padding: 11,
      background: on ? `${cssVar(m.accent)}0c` : 'var(--card)', border: `1px solid ${open ? cssVar(m.accent) : on ? `${cssVar(m.accent)}3a` : 'var(--border)'}`,
      boxShadow: open ? `0 0 0 1px ${cssVar(m.accent)}55` : 'none', transition: 'border-color .15s, background .15s', cursor: 'pointer' }}
    onClick={() => onOpen(open ? null : id)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        {draggable && <span onPointerDown={reorder.onHandleDown(id)} title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--muted)', fontSize: 13, lineHeight: 1, touchAction: 'none' }}>⠿</span>}
        <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: on ? 'var(--text)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</div>
        </div>
        <Switch on={st.enabled} onChange={(v) => rs.setEnabled(id, v)} accent={m.accent} size="sm" />
      </div>
      <div style={{ minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CompactControls id={id} rs={rs} playing={playing} knobSize={36} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        {m.worklet ? <WorkletPill ready={playing} /> : <span />}
        <span className="mono" style={{ fontSize: 8.5, color: open ? m.accent : 'var(--muted)' }}>{open ? 'editing ▾' : 'edit ▸'}</span>
      </div>
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>);

}

function Connector() {
  return <div style={{ flexShrink: 0, alignSelf: 'center', color: 'var(--muted)', fontSize: 14, padding: '0 2px' }}>→</div>;
}

function CreativeTray({ rs, playing, onOpen }) {
  const [open, setOpen] = useRL(false);
  const activeCreative = CREATIVE_IDS.filter((id) => rs.mod[id].enabled).length;
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--violet)', fontWeight: 700 }}>+ CREATIVE FX</span>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>{activeCreative} of {CREATIVE_IDS.length} inserted · per-element effects</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>{open ? '▴' : '▾'}</span>
      </button>
      {open &&
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {CREATIVE_IDS.map((id) => {const m = MANIFEST_BY_ID[id],on = rs.mod[id].enabled;return (
            <div key={id} data-chip onClick={() => onOpen(rs.selected === id ? null : id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', borderRadius: 8, cursor: 'pointer',
              background: on ? `${cssVar(m.accent)}0c` : 'rgba(255,255,255,0.02)', border: `1px solid ${rs.selected === id ? cssVar(m.accent) : on ? `${cssVar(m.accent)}3a` : 'var(--border)'}` }}>
              <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={22} />
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600 }}>{m.label}</div>
                <div className="mono" style={{ fontSize: 8.5, color: 'var(--muted)' }}>{m.sub}</div>
              </div>
              <Switch on={on} onChange={(v) => rs.setEnabled(id, v)} accent={m.accent} size="sm" />
            </div>);
        })}
        </div>
      }
    </div>);

}

function PitchLane({ rs, playing }) {
  const m = PITCH_MODULE,st = rs.mod.pitch,on = st.enabled;
  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', borderRadius: 9, background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.22)' }}>
      <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={24} />
      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Pitch <span className="mono" style={{ fontSize: 8.5, color: 'var(--violet)', marginLeft: 4 }}>SEPARATE LANE</span></div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--muted)' }}>not an insert · pitch + tempo coupled</div>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginLeft: 'auto' }}>
        {m.params.map((p) => <ParamControl key={p.key} p={p} value={st[p.key]} accent={m.accent} dim={!on} knobSize={38} onChange={(k, v) => rs.setParam('pitch', k, v)} />)}
        <Switch on={on} onChange={(v) => rs.setEnabled('pitch', v)} accent={m.accent} />
      </div>
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>);

}

// ════════════════════════════════════════════════════════════════════════
// A · PEDALBOARD
// ════════════════════════════════════════════════════════════════════════
function PedalboardRack({ rs, playing }) {
  const reorder = useChainReorder(rs.order, rs.setOrder);
  const masterChain = rs.order.filter((id) => MASTERING_IDS.includes(id));
  return (
    <div className="card" style={{ overflow: 'visible' }}>
      <div className="card-hd" style={{ borderBottom: '1px solid var(--border)' }}><RackChrome rs={rs} playing={playing} /></div>
      <div className="card-body">
        <div ref={reorder.containerRef} style={{ display: 'flex', alignItems: 'stretch', gap: 4, overflowX: 'auto', paddingBottom: 6 }}>
          <div style={{ flexShrink: 0, alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingRight: 4 }}>
            <span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>IN</span>
            <span style={{ color: 'var(--cyan)', fontSize: 14 }}>→</span>
          </div>
          {masterChain.map((id, i) =>
          <React.Fragment key={id}>
              {i > 0 && <Connector />}
              <PedalCard id={id} rs={rs} playing={playing} onOpen={rs.setSelected} reorder={reorder} draggable />
            </React.Fragment>
          )}
          <div style={{ flexShrink: 0, alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingLeft: 4 }}>
            <span style={{ color: 'var(--cyan)', fontSize: 14 }}>→</span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>OUT</span>
          </div>
        </div>
        {rs.selected &&
        <div style={{ marginTop: 14 }}><ExpandedPanel id={rs.selected} rs={rs} playing={playing} onClose={() => rs.setSelected(null)} /></div>
        }
        <CreativeTray rs={rs} playing={playing} onOpen={rs.setSelected} />
        <PitchLane rs={rs} playing={playing} />
      </div>
    </div>);

}

// ════════════════════════════════════════════════════════════════════════
// B · CONSOLE  (vertical channel strips)
// ════════════════════════════════════════════════════════════════════════
const STRIP_PRIMARY = { eq: null, comp: 'thresholdDb', sat: 'drive', ms: 'width', limiter: 'ceilingDb', trim: 'gainDb' };
const STRIP_KNOBS = { comp: ['ratio', 'makeupDb'], sat: ['mix', 'tone'], ms: ['midGainDb', 'sideGainDb'], limiter: ['releaseMs'], trim: [] };

function ChannelStrip({ id, rs, playing }) {
  const m = MANIFEST_BY_ID[id],st = rs.mod[id],on = st.enabled && !rs.masterBypass;
  const gr = useFakeGR(m.hasMeter ? st.enabled : false, playing, id === 'limiter' ? 4 : 6);
  const primary = STRIP_PRIMARY[id];
  const pP = primary && m.params.find((p) => p.key === primary);
  return (
    <div onClick={() => rs.setSelected(rs.selected === id ? null : id)} style={{ width: 96, flexShrink: 0, padding: '12px 8px', borderRadius: 9, cursor: 'pointer',
      background: on ? `${cssVar(m.accent)}0a` : 'var(--card)', border: `1px solid ${rs.selected === id ? cssVar(m.accent) : on ? `${cssVar(m.accent)}33` : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
      <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={26} />
      <div style={{ fontSize: 10.5, fontWeight: 700, color: on ? 'var(--text)' : 'var(--text-2)', textAlign: 'center', lineHeight: 1.1, height: 24 }}>{m.label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', minHeight: 116 }}>
        {id === 'eq' ?
        <div style={{ height: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}><MiniEqCurve bands={st.bands} on={on} width={74} height={46} /><span className="mono" style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '0.06em' }}>8-BAND</span></div> :
        pP && <Fader value={st[primary]} min={pP.min} max={pP.max} step={pP.step} unit={pP.unit} label={pP.label} accent={m.accent} height={110} dim={!on} onChange={(v) => rs.setParam(id, primary, v)} />}
        {m.hasMeter && <GRMeter reductionDb={gr} height={110} label="GR" />}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', minHeight: 44, flexWrap: 'wrap' }}>
        {(STRIP_KNOBS[id] || []).map((k) => {const p = m.params.find((x) => x.key === k);return p ? <Knob key={k} value={st[k]} min={p.min} max={p.max} step={p.step} unit={p.unit} label={p.label} accent={m.accent} size={32} bipolar={p.control === 'knobBipolar'} dim={!on} onChange={(v) => rs.setParam(id, k, v)} /> : null;})}
      </div>
      <Switch on={st.enabled} onChange={(v) => rs.setEnabled(id, v)} accent={m.accent} size="sm" />
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>);

}

function ConsoleRack({ rs, playing }) {
  const masterGr = useFakeGR(rs.mod.limiter.enabled, playing, 4);
  return (
    <div className="card" style={{ overflow: 'visible' }}>
      <div className="card-hd"><RackChrome rs={rs} playing={playing} dense /></div>
      <div className="card-body">
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', overflowX: 'auto', paddingBottom: 4 }}>
          {MASTERING_IDS.map((id) => <ChannelStrip key={id} id={id} rs={rs} playing={playing} />)}
          {/* master section */}
          <div style={{ width: 120, flexShrink: 0, padding: '12px 10px', borderRadius: 9, background: 'linear-gradient(180deg, rgba(0,229,176,0.06), rgba(0,229,176,0.01))', border: '1px solid rgba(0,229,176,0.32)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--cyan)', fontWeight: 700 }}>MASTER</span>
            <GRMeter reductionDb={masterGr} height={120} label="OUT GR" />
            <button onClick={() => rs.setMasterBypass(!rs.masterBypass)} className="btn sm" style={{ width: '100%', justifyContent: 'center', color: rs.masterBypass ? 'var(--cyan)' : 'var(--text-2)' }}>{rs.masterBypass ? 'BYPASSED' : 'A / B'}</button>
            <button onClick={rs.reset} className="btn ghost sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--muted)' }}>↺ Reset</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--violet)', fontWeight: 700 }}>CREATIVE FX</span>
          {CREATIVE_IDS.map((id) => {const m = MANIFEST_BY_ID[id],on = rs.mod[id].enabled;return (
              <button key={id} onClick={() => rs.setSelected(rs.selected === id ? null : id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 7, border: `1px solid ${on ? `${cssVar(m.accent)}55` : 'var(--border)'}`, background: on ? `${cssVar(m.accent)}10` : 'transparent' }}>
              <span style={{ color: on ? m.accent : 'var(--muted)', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{m.glyph}</span>
              <span className="mono" style={{ fontSize: 10, color: on ? 'var(--text)' : 'var(--muted)' }}>{m.label}</span>
            </button>);
          })}
          <div style={{ marginLeft: 'auto' }}><Switch on={rs.mod.pitch.enabled} onChange={(v) => rs.setEnabled('pitch', v)} accent="var(--violet)" /></div>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Pitch lane</span>
        </div>
        {rs.selected && <div style={{ marginTop: 14 }}><ExpandedPanel id={rs.selected} rs={rs} playing={playing} onClose={() => rs.setSelected(null)} /></div>}
      </div>
    </div>);

}

// ════════════════════════════════════════════════════════════════════════
// C · STUDIO DRAWER  (room-first; rack collapses)
// ════════════════════════════════════════════════════════════════════════
function StudioRack({ rs, playing, open, setOpen }) {
  return (
    <div className="card" style={{ overflow: 'visible' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.32)', color: 'var(--cyan)', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>⚙</span>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Studio rack</div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>{rs.activeCount} effects on · drag the chain, tweak the master</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {rs.order.filter((id) => rs.mod[id].enabled).slice(0, 5).map((id) => <ModuleIcon key={id} glyph={MANIFEST_BY_ID[id].glyph} accent={MANIFEST_BY_ID[id].accent} on size={22} />)}
          <span className="btn sm" style={{ pointerEvents: 'none' }}>{open ? 'Close ▾' : 'Open Studio ▴'}</span>
        </div>
      </button>
      {open &&
      <div style={{ borderTop: '1px solid var(--border)', padding: 18 }}>
          <div style={{ marginBottom: 14 }}><RackChrome rs={rs} playing={playing} dense /></div>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--cyan)', fontWeight: 700, marginBottom: 10 }}>MASTERING</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 10 }}>
            {MASTERING_IDS.map((id) => <PedalCard key={id} id={id} rs={rs} playing={playing} onOpen={rs.setSelected} reorder={{ onHandleDown: () => () => {} }} draggable={false} />)}
          </div>
          {rs.selected && <div style={{ marginTop: 14 }}><ExpandedPanel id={rs.selected} rs={rs} playing={playing} onClose={() => rs.setSelected(null)} /></div>}
          <CreativeTray rs={rs} playing={playing} onOpen={rs.setSelected} />
          <PitchLane rs={rs} playing={playing} />
        </div>
      }
    </div>);

}

function ChainCap({ label, right }) {
  return (
    <div style={{ flexShrink: 0, alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: right ? '0 0 0 4px' : '0 4px 0 0' }}>
      {right ?
      <><span style={{ color: 'var(--cyan)', fontSize: 14 }}>→</span><span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{label}</span></> :
      <><span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{label}</span><span style={{ color: 'var(--cyan)', fontSize: 14 }}>→</span></>}
    </div>);

}

// rich module panel — full param set inline, no drill-down
function RichModulePanel({ id, rs, playing, reorder, draggable, pos, registerRef }) {
  const m = MANIFEST_BY_ID[id],st = rs.mod[id],on = st.enabled && !rs.masterBypass;
  const wide = id === 'eq';
  const dragging = reorder.draggingId === id;
  return (
    <div data-chip ref={registerRef} onDoubleClick={() => rs.setEnabled(id, !st.enabled)}
    style={{ flexShrink: 0, width: wide ? 300 : 212, borderRadius: 11, padding: 12, position: 'relative', transition: 'box-shadow .12s, transform .12s',
      background: on ? `${cssVar(m.accent)}0b` : 'var(--card)',
      border: `1px solid ${dragging ? 'var(--cyan)' : on ? `${cssVar(m.accent)}38` : 'var(--border)'}`,
      outline: dragging ? '2px dashed var(--cyan)' : 'none', outlineOffset: 2,
      boxShadow: dragging ? '0 14px 36px -10px rgba(0,229,176,0.55)' : 'none',
      transform: dragging ? 'scale(1.02)' : 'none', zIndex: dragging ? 5 : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {draggable && <span onPointerDown={reorder.onHandleDown(id)} title="Drag to reorder" style={{ cursor: 'grab', color: dragging ? 'var(--cyan)' : 'var(--muted)', fontSize: 13, touchAction: 'none' }}>⠿</span>}
        <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: on ? 'var(--text)' : 'var(--text-2)' }}>{m.label}</div>
          <div className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{pos != null ? `#${pos} · ` : ''}{m.sub}</div>
        </div>
        {m.worklet && <WorkletPill ready={playing} />}
        <Switch on={st.enabled} onChange={(v) => rs.setEnabled(id, v)} accent={m.accent} size="sm" />
      </div>
      <RichControls id={id} rs={rs} playing={playing} />
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>);

}

// abbreviated chain map — all modules as icons in signal order, drag to reorder
function ChainMap({ rs, onFocus, showInactive, setShowInactive }) {
  const reorder = useChainReorder(rs.order, rs.setOrder);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', fontWeight: 700, marginRight: 2 }}>CHAIN</span>
      <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>in</span>
      <div ref={reorder.containerRef} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {rs.order.map((id, i) => {
          const m = MANIFEST_BY_ID[id],on = rs.mod[id].enabled && !rs.masterBypass;
          const dragging = reorder.draggingId === id;
          return (
            <React.Fragment key={id}>
              {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>›</span>}
              <button data-chip onPointerDown={reorder.onHandleDown(id)} onClick={() => onFocus && onFocus(id)} onDoubleClick={() => rs.setEnabled(id, !rs.mod[id].enabled)} title={`${m.label} — click to focus · double-click to ${on ? 'disable' : 'enable'} · drag to reorder`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, cursor: 'grab', touchAction: 'none', transition: 'transform .1s, box-shadow .1s',
                background: dragging ? 'rgba(0,229,176,0.18)' : on ? `${cssVar(m.accent)}14` : 'rgba(255,255,255,0.02)', border: `1px solid ${dragging ? 'var(--cyan)' : on ? `${cssVar(m.accent)}44` : 'var(--border)'}`, boxShadow: dragging ? '0 0 0 2px rgba(0,229,176,0.4)' : 'none', transform: dragging ? 'scale(1.08)' : 'none' }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: on ? m.accent : 'var(--muted)' }}>{m.glyph}</span>
                <span className="mono" style={{ fontSize: 9, color: on ? 'var(--text-2)' : 'var(--muted)' }}>{m.label.split(' ')[0]}</span>
              </button>
            </React.Fragment>);

        })}
      </div>
      <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>→ Σ out</span>
      {setShowInactive &&
      <label title="Show disabled devices as full panels below (they always stay in this mini map)" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.04em', color: showInactive ? 'var(--text-2)' : 'var(--muted)' }}>Show inactive</span>
        <Switch on={showInactive} onChange={setShowInactive} size="sm" />
      </label>}
    </div>);

}

// PRIMARY rack — rich horizontal chain, controls exposed, drag-reorder
function PresetMenu({ presets, onRecall }) {
  const [open, setOpen] = useRL(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} className="btn sm" style={{ fontSize: 10.5 }}>Presets {presets.length ? `(${presets.length})` : ''} ▾</button>
      {open &&
      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20, minWidth: 210, borderRadius: 9, background: 'var(--card-2)', border: '1px solid var(--border-2)', boxShadow: '0 12px 30px -10px rgba(0,0,0,0.6)', padding: 6 }}>
          {presets.length === 0 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', padding: 8 }}>No saved presets yet.</div>}
          {presets.map((p) =>
        <button key={p.id} onClick={() => {onRecall(p);setOpen(false);}} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</span>
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--muted)', marginLeft: 'auto' }}>{p.n} on · by {p.by}</span>
            </button>
        )}
        </div>
      }
    </div>);

}

function InlineRack({ rs, playing, controller }) {
  const reorder = useChainReorder(rs.order, rs.setOrder);
  const panelEls = React.useRef({});
  const [showInactive, setShowInactive] = useRL(true);
  const focusModule = (id) => {const cont = reorder.containerRef.current,el = panelEls.current[id];if (cont && el) cont.scrollTo({ left: Math.max(0, el.offsetLeft - 24), behavior: 'smooth' });};
  const chain = rs.order.filter((id) => showInactive ? (MASTERING_IDS.includes(id) || rs.mod[id].enabled) : rs.mod[id].enabled);
  const disabledCreative = CREATIVE_IDS.filter((id) => !rs.mod[id].enabled);
  return (
    <div className="card rack-panel" style={{ overflow: 'visible' }}>
      <div className="card-hd"><RackChrome rs={rs} playing={playing} dense /></div>
      <div className="card-body">
        <ChainMap rs={rs} onFocus={focusModule} showInactive={showInactive} setShowInactive={setShowInactive} />
        <div ref={reorder.containerRef} style={{ display: 'flex', alignItems: 'stretch', gap: 6, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 8 }}>
          <ChainCap label="IN" />
          {chain.map((id, i) =>
          <React.Fragment key={id}>
              {i > 0 && <Connector />}
              <RichModulePanel id={id} rs={rs} playing={playing} reorder={reorder} draggable pos={i + 1} registerRef={(el) => {panelEls.current[id] = el;}} />
            </React.Fragment>
          )}
          <ChainCap label="OUT" right />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--violet)', fontWeight: 700 }}>+ CREATIVE FX</span>
          {disabledCreative.length === 0 ?
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>all inserted</span> :
          disabledCreative.map((id) => {const m = MANIFEST_BY_ID[id];return (
              <button key={id} onClick={() => rs.setEnabled(id, true)} title={m.summary} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent' }}>
                <span style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{m.glyph}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>{m.label}</span>
                <span style={{ color: m.accent, fontSize: 12, fontWeight: 700 }}>+</span>
              </button>);
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Pitch lane</span>
            <Switch on={rs.mod.pitch.enabled} onChange={(v) => rs.setEnabled('pitch', v)} accent="var(--violet)" />
          </div>
        </div>
        {rs.mod.pitch.enabled && <div style={{ marginTop: 12 }}><PitchLane rs={rs} playing={playing} /></div>}
      </div>
    </div>);

}

Object.assign(window, { PedalboardRack, ConsoleRack, StudioRack, InlineRack, RichModulePanel, ChainCap });