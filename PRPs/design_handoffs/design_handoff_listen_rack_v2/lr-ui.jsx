/* spectre — Listen Rack redesign. Primitives + rack state. Data comes from redesign/data.jsx. */
const { useState: uS, useEffect: uE, useRef: uR, useMemo: uM, useCallback: uC } = React;

function lrClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lrTime(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
function lrDrag(el, e, cb, vertical) {
  const r = el.getBoundingClientRect();
  const move = (ev) => cb(lrClamp(vertical ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width, 0, 1));
  move(e);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

// ── Switch ────────────────────────────────────────────────────────────
function Sw({ on, onChange, title }) {
  return <button className={'lr-sw' + (on ? ' on' : '')} title={title} aria-pressed={on}
    onClick={(e) => { e.stopPropagation(); onChange(!on); }} />;
}

// ── Horizontal param slider ───────────────────────────────────────────
function PSlider({ label, value, min, max, step, unit, onChange, wide }) {
  const ref = uR(null);
  const pct = ((value - min) / (max - min)) * 100;
  const set = (t) => { let v = min + t * (max - min); if (step) v = Math.round(v / step) * step; onChange(+v.toFixed(4)); };
  return (
    <div className={'lr-pc' + (wide ? ' wide' : '')}>
      <div className="lr-pc-l"><span className="k">{label}</span><span className="v">{fmtVal(unit, value)}</span></div>
      <div className="lr-sl" ref={ref} onPointerDown={(e) => { e.preventDefault(); lrDrag(ref.current, e, set); }}>
        <div className="tk"><div className="fl" style={{ width: pct + '%' }} /><div className="th" style={{ left: pct + '%' }} /></div>
      </div>
    </div>);
}

// ── Segmented / select / toggle param controls ─────────────────────────
function PSeg({ label, value, options, onChange }) {
  return (
    <div className="lr-pc" style={{ width: 'auto' }}>
      <div className="lr-pc-l"><span className="k">{label}</span></div>
      <div className="lr-seg">{options.map((o) =>
        <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>)}
      </div>
    </div>);
}
function PSelect({ label, value, options, onChange }) {
  return (
    <div className="lr-pc" style={{ width: 'auto' }}>
      <div className="lr-pc-l"><span className="k">{label}</span></div>
      <select className="lr-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>);
}
function PToggle({ label, value, onChange }) {
  return <label className="lr-tg">{label}<Sw on={!!value} onChange={onChange} /></label>;
}
function ParamControl({ p, value, onChange }) {
  if (p.control === 'toggle') return <PToggle label={p.label} value={value} onChange={onChange} />;
  if (p.control === 'select') return <PSelect label={p.label} value={value} options={p.options} onChange={onChange} />;
  if (p.control === 'segmented') return <PSeg label={p.label} value={value} options={p.options} onChange={onChange} />;
  return <PSlider label={p.label} value={value} min={p.min} max={p.max} step={p.step || (p.max - p.min) / 100} unit={p.unit} onChange={onChange} wide={p.control === 'slider'} />;
}

// ── EQ band strip (8 vertical gain faders) ─────────────────────────────
function EqBand({ b, onChange }) {
  const ref = uR(null);
  const t = (b.gainDb + 24) / 48, top = Math.max(t, 0.5), bot = Math.min(t, 0.5);
  return (
    <div className={'lr-eqb' + (b.enabled ? '' : ' off')}>
      <span className="g">{b.gainDb > 0 ? '+' : ''}{b.gainDb.toFixed(1)}</span>
      <div className="vs" ref={ref} onPointerDown={(e) => { e.preventDefault(); lrDrag(ref.current, e, (v) => onChange({ gainDb: +(v * 48 - 24).toFixed(1) }), true); }}
        onDoubleClick={() => onChange({ gainDb: 0 })} title={`${b.freq} Hz · ${b.type} · double-click to zero`}>
        <div className="vt">
          <div className="vf" style={{ bottom: bot * 100 + '%', height: (top - bot) * 100 + '%' }} />
          <div className="vh" style={{ bottom: t * 100 + '%' }} />
        </div>
      </div>
      <span className="f">{b.freq >= 1000 ? (b.freq / 1000) + 'k' : b.freq}</span>
      <Sw on={b.enabled} onChange={(v) => onChange({ enabled: v })} title="band on/off" />
    </div>);
}
function EqStrip({ bands, setBand }) {
  return <div className="lr-eq">{bands.map((b, i) => <EqBand key={i} b={b} onChange={(p) => setBand(i, p)} />)}</div>;
}

// ── Rack state (mirrors audio/state.ts shape) ─────────────────────────
const LR_SEED = {
  eq: { enabled: true, bands: EQ_BANDS_DEFAULT.map((b, i) => ({ ...b, gainDb: [0, -2, 0, 0, 0, 0, 2, 1.5][i] })) },
  comp: { enabled: true, thresholdDb: -18, ratio: 2, attackMs: 22, releaseMs: 180, makeupDb: 1.5 },
  limiter: { enabled: true, ceilingDb: -1.0 },
  sat: { enabled: true, drive: 0.22, mix: 0.3, curve: 'tube' },
};
function useRack() {
  const [mod, setMod] = uS(() => {
    const m = JSON.parse(JSON.stringify(MODULE_DEFAULTS));
    Object.keys(LR_SEED).forEach((k) => { m[k] = { ...m[k], ...JSON.parse(JSON.stringify(LR_SEED[k])) }; });
    return m;
  });
  const [order, setOrder] = uS(DEFAULT_ORDER);
  const [bypass, setBypass] = uS(false);
  const [presets, setPresets] = uS([{ id: 'p0', name: 'Streaming safe' }, { id: 'p1', name: 'Club preview' }]);
  const patch = uC((id, p) => setMod((m) => ({ ...m, [id]: { ...m[id], ...p } })), []);
  const toggle = uC((id) => setMod((m) => ({ ...m, [id]: { ...m[id], enabled: !m[id].enabled } })), []);
  const reset = uC((id) => setMod((m) => ({ ...m, [id]: JSON.parse(JSON.stringify(MODULE_DEFAULTS[id])) })), []);
  const move = uC((id, d) => setOrder((o) => {
    const i = o.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= o.length) return o;
    const n = [...o]; n.splice(j, 0, n.splice(i, 1)[0]); return n;
  }), []);
  const reorder = uC((fromId, toId) => setOrder((o) => {
    if (fromId === toId) return o;
    const n = o.filter((x) => x !== fromId);
    const at = toId == null ? n.length : n.indexOf(toId);
    n.splice(at < 0 ? n.length : at, 0, fromId);
    return n;
  }), []);
  const setBand = uC((i, p) => setMod((m) => ({ ...m, eq: { ...m.eq, bands: m.eq.bands.map((b, k) => k === i ? { ...b, ...p } : b) } })), []);
  const applyFix = uC((ap) => setMod((m) => { const n = { ...m }; Object.keys(ap).forEach((k) => { n[k] = { ...n[k], ...ap[k] }; }); return n; }), []);
  const savePreset = uC(() => setPresets((p) => [...p, { id: 'p' + p.length, name: 'Chain ' + (p.length + 1) }]), []);
  return { mod, order, bypass, setBypass, patch, toggle, reset, move, reorder, setBand, applyFix, presets, savePreset };
}

// ── Compact param summary shown on a card / row ────────────────────────
function paramSummary(m, v) {
  if (m.perBand) {
    const on = v.bands.filter((b) => b.enabled && b.gainDb !== 0);
    if (!on.length) return null;
    return on.slice(0, 3).map((b) => `${b.freq >= 1000 ? (b.freq / 1000) + 'k' : b.freq} ${b.gainDb > 0 ? '+' : ''}${b.gainDb}`).join(' · ');
  }
  const out = [];
  m.params.forEach((p) => {
    if (p.key === 'enabled') return;
    const val = v[p.key];
    if (val === p.default || val == null) return;
    out.push(fmtVal(p.unit, val, { dp: 2 }));
  });
  return out.slice(0, 3).join(' · ') || null;
}
Object.assign(window, { lrClamp, lrTime, lrDrag, Sw, PSlider, PSeg, PSelect, PToggle, ParamControl, EqBand, EqStrip, useRack, paramSummary });
