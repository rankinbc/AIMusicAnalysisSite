/* spectre — Listen Rack redesign. "Devices" view: realistic pedal bays with rotary knobs.
   Same rack state + manifest as the grid/list views — only the presentation differs. */
const { useRef: dR, useState: dS } = React;

const lrCssVar = (v) => (typeof v === 'string' && v.startsWith('var(')
  ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#00e5b0' : v);

function useDragValue({ value, min, max, step, onChange, range = 170 }) {
  const ref = dR(null), start = dR(null);
  const onPointerDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    start.current = { y: e.clientY, v: value };
    const move = (ev) => {
      const dv = ((start.current.y - ev.clientY) / range) * (max - min);
      let nv = lrClamp(start.current.v + dv, min, max);
      if (step) nv = Math.round(nv / step) * step;
      onChange(+nv.toFixed(4));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return { ref, onPointerDown };
}

// ── Rotary knob ────────────────────────────────────────────────────────
function LRKnob({ value, min, max, step, unit, label, accent, size = 38, bipolar, onChange, dim, hint }) {
  const drag = useDragValue({ value, min, max, step, onChange });
  const t = (value - min) / (max - min);
  const A0 = -135, A1 = 135, ang = A0 + t * (A1 - A0);
  const r = size / 2, tr = r - 3.5;
  const polar = (deg, rad) => [r + rad * Math.cos((deg - 90) * Math.PI / 180), r + rad * Math.sin((deg - 90) * Math.PI / 180)];
  const arc = (a0, a1) => {
    const [x0, y0] = polar(a0, tr), [x1, y1] = polar(a1, tr);
    return `M ${x0} ${y0} A ${tr} ${tr} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`;
  };
  const acc = dim ? 'var(--muted)' : accent;
  const [px, py] = polar(ang, tr - 1), [ix, iy] = polar(ang, tr - size * 0.3);
  return (
    <div className="lr-knob">
      <span className="kl">{label}</span>
      <div className="kb" ref={drag.ref} onPointerDown={drag.onPointerDown} title={hint || 'drag vertically'} style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={r} cy={r} r={tr} fill="url(#lrkg)" stroke="var(--border-2)" />
          <path d={arc(A0, A1)} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" strokeLinecap="round" />
          <path d={arc(bipolar ? 0 : A0, ang)} fill="none" stroke={acc} strokeWidth="3" strokeLinecap="round"
            style={{ filter: dim ? 'none' : `drop-shadow(0 0 4px ${lrCssVar(accent)}88)` }} />
          <line x1={ix} y1={iy} x2={px} y2={py} stroke={acc} strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <span className="kv" style={{ color: dim ? 'var(--muted)' : 'var(--text-2)' }}>{fmtVal(unit, value)}</span>
    </div>);
}

// ── Vertical fader (EQ bands, depth) ───────────────────────────────────
function LRFader({ value, min, max, step, label, unit, accent, height = 74, onChange, dim, fmt }) {
  const drag = useDragValue({ value, min, max, step, onChange, range: height * 1.6 });
  const t = (value - min) / (max - min);
  const acc = dim ? 'var(--muted)' : accent;
  return (
    <div className="lr-fad">
      <span className="fv">{fmt ? fmt(value) : fmtVal(unit, value)}</span>
      <div className="fb" ref={drag.ref} onPointerDown={drag.onPointerDown} style={{ height }}>
        <span className="ft" /><span className="ff" style={{ height: t * 100 + '%', background: acc }} />
        <span className="fh" style={{ bottom: `calc(${t * 100}% - 6px)`, borderColor: acc }} />
      </div>
      <span className="fl">{label}</span>
    </div>);
}

// ── GR meter (comp / gate / limiter) ───────────────────────────────────
function LRGr({ gr, height = 78 }) {
  const t = lrClamp(gr / 8, 0, 1);
  return (
    <div className="lr-grm">
      <div className="gt" style={{ height }}><span style={{ height: t * 100 + '%' }} /></div>
      <span className="gl">GR</span>
    </div>);
}

// ── One device bay ─────────────────────────────────────────────────────
function DeviceBay({ m, i, rack, gr, tw, onClose }) {
  const v = rack.mod[m.id], on = v.enabled && !rack.bypass, dim = !on;
  const knob = 44;
  const sliders = m.params.filter((p) => p.control === 'slider');
  const knobs = m.params.filter((p) => p.control === 'knob' || p.control === 'knobBipolar');
  const enums = m.params.filter((p) => p.control === 'select' || p.control === 'segmented');
  const toggles = m.params.filter((p) => p.control === 'toggle' && p.key !== 'enabled');
  return (
    <div className={'lr-bay open' + (on ? ' on' : '')} style={{ '--mac': m.accent }}>
      <svg width="0" height="0" style={{ position: 'absolute' }}><defs>
        <radialGradient id="lrkg" cx="50%" cy="30%"><stop offset="0%" stopColor="#242c3d" /><stop offset="100%" stopColor="#141a28" /></radialGradient>
      </defs></svg>
      <div className="lr-bay-h">
        <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
        <span className="lr-mc-t">
          <span className="lr-mc-n">{m.label}</span>
          <span className="lr-mc-s">{i < 0 ? 'buffer lane · not an insert' : '#' + String(i + 1).padStart(2, '0') + ' in chain'} · {m.sub}</span>
        </span>
        {m.worklet && tw.workletFlag && <span className="wk" title="AudioWorklet — brief init">wk</span>}
        {tw.showBind && <span className="lr-bind">{m.bind}</span>}
        <button className="lr-ib" title="Reset to neutral" onClick={(e) => { e.stopPropagation(); rack.reset(m.id); }}><Icon name="refresh" size={13} /></button>
        <Sw on={v.enabled} onChange={() => rack.toggle(m.id)} />
        {onClose && <button className="lr-ib" title="Close" onClick={onClose}><Icon name="x" size={13} /></button>}
      </div>
      <div className="lr-bay-b">
        {m.perBand
          ? <div className="lr-bay-eq">{v.bands.map((b, bi) =>
            <LRFader key={bi} value={b.gainDb} min={-24} max={24} step={0.5} accent={m.accent} dim={dim} height={70}
              label={b.freq >= 1000 ? (b.freq / 1000) + 'k' : b.freq} fmt={(g) => (g > 0 ? '+' : '') + g.toFixed(1)}
              onChange={(g) => rack.setBand(bi, { gainDb: g })} />)}
          </div>
          : <React.Fragment>
            {!!knobs.length && <div className="lr-bay-row">{knobs.map((p) =>
              <LRKnob key={p.key} label={p.label} value={v[p.key]} min={p.min} max={p.max} step={p.step} unit={p.unit}
                accent={m.accent} dim={dim} size={knob} bipolar={p.control === 'knobBipolar'} hint={p.hint}
                onChange={(nv) => rack.patch(m.id, { [p.key]: nv })} />)}
              {m.hasMeter && <LRGr gr={on ? gr : 0} height={knob + 34} />}
            </div>}
            {!!enums.length && <div className="lr-bay-row lr-wrap">{enums.map((p) =>
              <ParamControl key={p.key} p={p} value={v[p.key]} onChange={(nv) => rack.patch(m.id, { [p.key]: nv })} />)}
            </div>}
            {sliders.map((p) =>
              <PSlider key={p.key} label={p.label} value={v[p.key]} min={p.min} max={p.max} step={p.step} unit={p.unit}
                onChange={(nv) => rack.patch(m.id, { [p.key]: nv })} wide />)}
            {!!toggles.length && <div className="lr-bay-row lr-wrap">{toggles.map((p) =>
              <PToggle key={p.key} label={p.label} value={v[p.key]} onChange={(nv) => rack.patch(m.id, { [p.key]: nv })} />)}
            </div>}
          </React.Fragment>}
      </div>
    </div>);
}

Object.assign(window, { LRKnob, LRFader, LRGr, DeviceBay, useDragValue, lrCssVar });
