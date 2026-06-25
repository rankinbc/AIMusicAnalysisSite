/* SPECTR · Listen rack redesign — rack core (state + shared module renderers)
 * Shared by all three IA directions. Holds the live module state and renders
 * controls straight from the manifest, so every direction binds identically.
 */
const { useState: useRS, useRef: useRR, useEffect: useRE, useCallback: useRC } = React;

// key params shown in a module's COMPACT card (1–3 most important)
const KEY_PARAMS = {
  comp: ['thresholdDb', 'ratio'], sat: ['drive', 'mix'], ms: ['width'], limiter: ['ceilingDb'],
  trim: ['gainDb'], djfilter: ['morph'], delay: ['mix', 'feedback'], reverb: ['mix', 'decaySec'],
  pan: ['pan'], tremolo: ['depth', 'rateHz'], gate: ['thresholdDb'], bitcrusher: ['bitDepth', 'mix'],
};

// ── rack state hook ────────────────────────────────────────────────────────
function useRackState() {
  const init = {};
  Object.keys(MODULE_DEFAULTS).forEach((id) => { init[id] = JSON.parse(JSON.stringify(MODULE_DEFAULTS[id])); });
  const [mod, setMod] = useRS(init);
  const [order, setOrder] = useRS([...DEFAULT_ORDER]);
  const [masterBypass, setMasterBypass] = useRS(false);
  const [selected, setSelected] = useRS(null);     // expanded module id
  const [showBind, setShowBind] = useRS(false);
  const [presets, setPresets] = useRS([]);

  const setParam = useRC((id, key, val) => setMod((m) => ({ ...m, [id]: { ...m[id], [key]: val } })), []);
  const setEnabled = useRC((id, on) => setMod((m) => ({ ...m, [id]: { ...m[id], enabled: on } })), []);
  const setEqBands = useRC((bands) => setMod((m) => ({ ...m, eq: { ...m.eq, bands } })), []);
  const reset = useRC(() => {
    const fresh = {}; Object.keys(MODULE_DEFAULTS).forEach((id) => { fresh[id] = JSON.parse(JSON.stringify(MODULE_DEFAULTS[id])); });
    setMod(fresh); setOrder([...DEFAULT_ORDER]); setMasterBypass(false);
  }, []);
  const applyCoach = useRC((apply) => setMod((m) => {
    const next = { ...m };
    Object.keys(apply).forEach((id) => { next[id] = { ...m[id], ...apply[id] }; });
    return next;
  }), []);
  const savePreset = useRC((by) => setPresets((p) => [...p, { id: Math.random().toString(36).slice(2), name: `Preset ${p.length + 1}`, by: by || 'you', order: [...order], mod: JSON.parse(JSON.stringify(mod)), n: Object.values(mod).filter((s) => s.enabled).length }]), [order, mod]);
  const recallPreset = useRC((pr) => { setMod(JSON.parse(JSON.stringify(pr.mod))); setOrder([...pr.order]); }, []);
  const activeCount = Object.values(mod).filter((s) => s.enabled).length;
  return { mod, order, setOrder, masterBypass, setMasterBypass, selected, setSelected, showBind, setShowBind, setParam, setEnabled, setEqBands, reset, applyCoach, activeCount, presets, savePreset, recallPreset };
}

// ── fake live gain-reduction for comp/gate/limiter ─────────────────────────
function useFakeGR(enabled, playing, depth = 6) {
  const [gr, setGr] = useRS(0);
  useRE(() => {
    if (!enabled || !playing) { setGr(0); return; }
    let raf = 0, t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const v = -(depth * (0.5 + 0.5 * Math.abs(Math.sin(t * 2.1)) * (0.6 + 0.4 * Math.sin(t * 5.3))));
      setGr(Math.round(v * 10) / 10);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, playing, depth]);
  return gr;
}

// ── small EQ curve thumbnail for the compact EQ card ───────────────────────
function MiniEqCurve({ bands, on, width = 120, height = 38 }) {
  const W = width, H = height, midY = H * 0.5;
  const gainAt = (xp) => bands.reduce((g, b) => { const bx = freqToX(b.freq), s = 0.085 / (b.q || 1) + 0.04; return g + b.gainDb * Math.exp(-Math.pow((xp - bx) / s, 2)); }, 0);
  const pts = []; for (let i = 0; i <= 60; i++) { const xp = i / 60; pts.push(`${i ? 'L' : 'M'} ${(xp * W).toFixed(1)} ${(midY - gainAt(xp) * 1.1).toFixed(1)}`); }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} preserveAspectRatio="none">
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 4" />
      <path d={pts.join(' ')} fill="none" stroke={on ? 'var(--cyan)' : 'var(--muted)'} strokeWidth="1.8" />
    </svg>
  );
}

// ── drag-reorder for a chain (pointer based) ───────────────────────────────
function useChainReorder(order, setOrder) {
  const containerRef = useRR(null);
  const dragId = useRR(null);
  const [draggingId, setDraggingId] = useRS(null);
  const onHandleDown = useRC((id) => (e) => {
    e.preventDefault(); e.stopPropagation();
    dragId.current = id; setDraggingId(id);
    const move = (ev) => {
      const cont = containerRef.current; if (!cont) return;
      const items = [...cont.querySelectorAll('[data-chip]')];
      const x = ev.clientX;
      let target = -1;
      items.forEach((el, i) => { const r = el.getBoundingClientRect(); if (x > r.left + r.width / 2) target = i; });
      const from = order.indexOf(dragId.current);
      const to = Math.max(0, Math.min(order.length - 1, target + 1));
      if (from !== -1 && to !== from) {
        const next = [...order]; next.splice(from, 1); next.splice(to > from ? to - 1 : to, 0, dragId.current); setOrder(next);
      }
    };
    const up = () => { dragId.current = null; setDraggingId(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); document.body.style.cursor = 'grabbing';
  }, [order, setOrder]);
  return { containerRef, onHandleDown, draggingId };
}

// ── rack chrome: active count + signal flow + A/B + reset + bindings ───────
function RackChrome({ rs, playing, dense }) {
  const flow = rs.order.filter((id) => rs.mod[id].enabled).map((id) => MANIFEST_BY_ID[id].label.split(' ')[0]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="dot" style={{ background: rs.masterBypass ? 'var(--muted)' : 'var(--cyan)', boxShadow: rs.masterBypass ? 'none' : '0 0 8px var(--cyan)' }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', fontWeight: 700, color: rs.masterBypass ? 'var(--muted)' : 'var(--cyan)', textTransform: 'uppercase' }}>INSERT RACK</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{rs.activeCount} on · bypass {rs.masterBypass ? 'on' : 'off'}</span>
      </div>
      {!dense && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
          <span style={{ color: 'var(--text-2)' }}>Signal</span>
          {flow.length ? flow.map((l, i) => <span key={i}>{i ? ' → ' : ''}<span style={{ color: 'var(--text-2)' }}>{l}</span></span>) : <span>flat (transparent)</span>}
          <span> → Σ</span>
        </div>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => rs.setShowBind(!rs.showBind)} className="mono" title="Show useAudioGraph bindings"
          style={{ fontSize: 9.5, padding: '5px 9px', borderRadius: 6, color: rs.showBind ? 'var(--cyan)' : 'var(--muted)', border: `1px solid ${rs.showBind ? 'rgba(0,229,176,0.4)' : 'var(--border)'}`, background: rs.showBind ? 'rgba(0,229,176,0.08)' : 'transparent' }}>⌁ Bindings</button>
        <button onClick={() => rs.setMasterBypass(!rs.masterBypass)} className="btn sm" style={{ color: rs.masterBypass ? 'var(--cyan)' : 'var(--text-2)', borderColor: rs.masterBypass ? 'rgba(0,229,176,0.4)' : 'var(--border)' }}>A / B Bypass</button>
        <button onClick={rs.reset} className="btn ghost sm" style={{ color: 'var(--muted)' }}>↺ Reset</button>
      </div>
    </div>
  );
}

// ── compact module summary controls (key knobs / mini-viz) ─────────────────
function CompactControls({ id, rs, playing, knobSize = 38 }) {
  const m = MANIFEST_BY_ID[id], st = rs.mod[id], on = st.enabled && !rs.masterBypass;
  const gr = useFakeGR(id === 'comp' || id === 'gate' || id === 'limiter' ? st.enabled : false, playing, id === 'limiter' ? 4 : id === 'gate' ? 10 : 6);
  if (id === 'eq') return <div style={{ opacity: on ? 1 : 0.5 }}><MiniEqCurve bands={st.bands} on={on} /></div>;
  const keys = KEY_PARAMS[id] || [];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {keys.map((k) => { const p = m.params.find((x) => x.key === k); if (!p) return null;
        return <ParamControl key={k} p={p} value={st[k]} accent={m.accent} dim={!on} knobSize={knobSize} onChange={(kk, v) => rs.setParam(id, kk, v)} />; })}
      {m.hasMeter && <GRMeter reductionDb={gr} open={id === 'gate' ? gr > -0.2 : undefined} height={knobSize + 8} label="GR" />}
    </div>
  );
}

// ── expanded full-param panel (popover/drawer body) ────────────────────────
function ExpandedPanel({ id, rs, playing, onClose }) {
  const m = MANIFEST_BY_ID[id], st = rs.mod[id], on = st.enabled;
  const gr = useFakeGR(m.hasMeter ? st.enabled : false, playing, id === 'limiter' ? 4 : id === 'gate' ? 10 : 6);
  return (
    <div style={{ borderRadius: 10, background: 'rgba(7,10,18,0.5)', border: `1px solid ${cssVar(m.accent)}33`, borderLeft: `3px solid ${m.accent}`, padding: 16, minWidth: 280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={26} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{m.label}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{m.sub}</div>
        </div>
        {m.worklet && <WorkletPill ready={playing} />}
        <Switch on={st.enabled} onChange={(v) => rs.setEnabled(id, v)} accent={m.accent} />
        {onClose && <button onClick={onClose} className="btn ghost sm" style={{ color: 'var(--muted)', padding: '3px 8px' }}>✕</button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, margin: '6px 0 14px' }}>{m.summary}</div>
      {id === 'eq'
        ? <EqBandEditor bands={st.bands} setBands={rs.setEqBands} accent={m.accent} dim={!on} />
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            {m.params.map((p) => <ParamControl key={p.key} p={p} value={st[p.key]} accent={m.accent} dim={!on} knobSize={44} onChange={(k, v) => rs.setParam(id, k, v)} />)}
            {m.hasMeter && <div style={{ marginLeft: 4 }}><GRMeter reductionDb={gr} open={id === 'gate' ? gr > -0.2 : undefined} height={96} /></div>}
          </div>
        )}
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>
  );
}

// 8-band EQ editor (expanded EQ)
function EqBandEditor({ bands, setBands, accent, dim }) {
  const setGain = (i, g) => setBands(bands.map((b, j) => j === i ? { ...b, gainDb: Math.max(-24, Math.min(24, g)) } : b));
  return (
    <div style={{ background: 'rgba(7,10,18,0.4)', borderRadius: 8, padding: '14px 12px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {bands.map((b, i) => { const on = Math.abs(b.gainDb) > 0.05; return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
            <span className="mono" style={{ fontSize: 9, fontWeight: 600, color: on && !dim ? accent : 'var(--muted)' }}>{b.gainDb > 0 ? '+' : ''}{b.gainDb.toFixed(1)}</span>
            <input type="range" min="-24" max="24" step="0.5" value={b.gainDb} onChange={(e) => setGain(i, parseFloat(e.target.value))} className="eq-slider" style={{ ['--eq-accent']: dim ? 'var(--muted)' : accent, writingMode: 'vertical-lr', direction: 'rtl', width: 6, height: 84 }} />
            <span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{b.freq >= 1000 ? (b.freq / 1000) + 'k' : b.freq}</span>
          </div>
        ); })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>Drag a band — curve redraws on the stage.</span>
        <button onClick={() => setBands(bands.map((b) => ({ ...b, gainDb: 0 })))} className="btn ghost sm" style={{ fontSize: 9.5, color: 'var(--muted)', padding: '3px 8px' }}>Flatten</button>
      </div>
    </div>
  );
}

// ── AI Coach strip (Solo mode): suggestions that apply to the rack ─────────
function CoachStrip({ rs }) {
  const [applied, setApplied] = useRS({});
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {COACH_SUGGESTIONS.map((c) => {
        const done = applied[c.id];
        return (
          <div key={c.id} style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', gap: 10, alignItems: 'flex-start', padding: 11, borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: `1px solid ${cssVar(c.color)}33`, borderLeft: `3px solid ${c.color}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: c.color, fontWeight: 700 }}>◆ {c.persona}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3, lineHeight: 1.3 }}>{c.title}</div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4 }}>→ {c.move}</div>
            </div>
            <button onClick={() => { rs.applyCoach(c.apply); setApplied((a) => ({ ...a, [c.id]: true })); }}
              className="btn sm" style={{ alignSelf: 'center', flexShrink: 0, color: done ? 'var(--green)' : 'var(--cyan)', borderColor: done ? 'rgba(52,211,153,0.4)' : 'rgba(0,229,176,0.4)' }}>{done ? '✓ Applied' : 'Apply'}</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Rich inline controls (no drill-down): show a module's whole param set ───
function RichControls({ id, rs, playing, knobSize = 34 }) {
  const m = MANIFEST_BY_ID[id], st = rs.mod[id], on = st.enabled && !rs.masterBypass;
  const gr = useFakeGR(m.hasMeter ? st.enabled : false, playing, id === 'limiter' ? 4 : id === 'gate' ? 10 : 6);
  if (id === 'eq') return <EqBandEditor bands={st.bands} setBands={rs.setEqBands} accent={m.accent} dim={!on} />;
  const skip = id === 'delay' ? ['bpm', 'enabled'] : ['enabled'];
  const params = m.params.filter((p) => !skip.includes(p.key));
  const knobs = params.filter((p) => p.control !== 'slider');
  const sliders = params.filter((p) => p.control === 'slider');
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '13px 12px', alignItems: 'flex-start', flex: 1 }}>
        {knobs.map((p) => <ParamControl key={p.key} p={p} value={st[p.key]} accent={m.accent} dim={!on} knobSize={knobSize} onChange={(k, v) => rs.setParam(id, k, v)} />)}
        {sliders.map((p) => <div key={p.key} style={{ width: '100%' }}><ParamControl p={p} value={st[p.key]} accent={m.accent} dim={!on} onChange={(k, v) => rs.setParam(id, k, v)} /></div>)}
      </div>
      {m.hasMeter && <GRMeter reductionDb={gr} open={id === 'gate' ? gr > -0.2 : undefined} height={knobSize * 2 + 24} />}
    </div>
  );
}

Object.assign(window, { useRackState, useFakeGR, KEY_PARAMS, MiniEqCurve, useChainReorder, RackChrome, CompactControls, ExpandedPanel, EqBandEditor, CoachStrip, RichControls });
