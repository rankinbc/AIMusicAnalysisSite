/* SPECTR · Listen rack redesign — shared control primitives (ported to TS)
 * Pro-tool knobs/faders/toggles/meters in the cool-neon language. Every control
 * is draggable (vertical drag) so the surface feels like the real instrument.
 */
import { useRef } from 'react';

import { fmtVal, type ParamDescriptor, type ParamValue, type Unit } from './data';
import { cssVar, hslToHex, sliderA11y, useDragValue } from './helpers';

// ── Rotary knob (the workhorse) ────────────────────────────────────────────
export function Knob({
  value, min, max, step, unit, label, accent = 'var(--cyan)', size = 44, bipolar = false, onChange, dim = false, hint,
}: {
  value: number; min: number; max: number; step?: number | undefined; unit?: Unit | undefined; label?: string;
  accent?: string; size?: number; bipolar?: boolean; onChange?: (v: number) => void; dim?: boolean | undefined; hint?: string | undefined;
}) {
  const drag = useDragValue({ value, min, max, step, onChange: onChange || (() => {}) });
  const t = (value - min) / (max - min);
  const A0 = -135, A1 = 135;
  const ang = A0 + t * (A1 - A0);
  const r = size / 2;
  const cx = r, cy = r;
  const trackR = r - 4;
  const polar = (deg: number, rad: number): [number, number] => [
    cx + rad * Math.cos((deg - 90) * Math.PI / 180),
    cy + rad * Math.sin((deg - 90) * Math.PI / 180),
  ];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = polar(a0, trackR), [x1, y1] = polar(a1, trackR);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M ${x0} ${y0} A ${trackR} ${trackR} 0 ${large} ${sweep} ${x1} ${y1}`;
  };
  const fillFrom = bipolar ? 0 : A0;
  const acc = dim ? 'var(--muted)' : accent;
  const [px, py] = polar(ang, trackR);
  const [pinX, pinY] = polar(ang, trackR - size * 0.16);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, userSelect: 'none' }}>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>}
      <div ref={drag.ref} onPointerDown={drag.onPointerDown} title={hint} className="lr-ctl"
        {...sliderA11y({ value, min, max, step, label, onChange: onChange || (() => {}), orientation: 'vertical' })}
        style={{ width: size, height: size, cursor: 'ns-resize', touchAction: 'none', position: 'relative' }}>
        <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
          <circle cx={cx} cy={cy} r={trackR} fill="rgba(7,10,18,0.6)" stroke="var(--border)" strokeWidth="1" />
          <path d={arc(A0, A1)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeLinecap="round" />
          <path d={arc(fillFrom, ang)} fill="none" stroke={acc} strokeWidth="3" strokeLinecap="round"
            style={{ filter: dim ? 'none' : `drop-shadow(0 0 4px ${cssVar(accent)}88)` }} />
          <line x1={pinX} y1={pinY} x2={px} y2={py} stroke={acc} strokeWidth="2" strokeLinecap="round" />
          {bipolar && <circle cx={polar(0, trackR + 3)[0]} cy={polar(0, trackR + 3)[1]} r="1" fill="var(--muted)" />}
        </svg>
      </div>
      {unit !== undefined && <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtVal(unit, value)}</span>}
    </div>
  );
}

// ── On/off switch ──────────────────────────────────────────────────────────
export function Switch({ on, onChange, accent = 'var(--cyan)', size = 'md' }: {
  on: boolean; onChange: (v: boolean) => void; accent?: string; size?: 'sm' | 'md';
}) {
  const w = size === 'sm' ? 26 : 30, h = size === 'sm' ? 14 : 16, k = h - 4;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      style={{ width: w, height: h, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: on ? accent : 'var(--dim)', border: 'none', transition: 'background .15s',
        boxShadow: on ? `0 0 8px ${cssVar(accent)}66` : 'none' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? w - k - 2 : 2, width: k, height: k, borderRadius: '50%',
        background: on ? '#06151a' : 'rgba(255,255,255,0.5)', transition: 'left .15s' }} />
    </button>
  );
}

// ── Segmented (enum, ≤3 short options) ─────────────────────────────────────
export function Segmented({ value, options, onChange, accent = 'var(--cyan)' }: {
  value: string; options: string[]; onChange: (v: string) => void; accent?: string;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      {options.map((o) => (
        <button type="button" key={o} onClick={(e) => { e.stopPropagation(); onChange(o); }} className="mono"
          style={{ fontSize: 9.5, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'lowercase',
            color: value === o ? '#06151a' : 'var(--muted)', background: value === o ? accent : 'transparent' }}>{o}</button>
      ))}
    </div>
  );
}

// ── Select (enum, many/long options) — cycles on click, shows current ──────
export function SelectChip({ value, options, onChange, accent = 'var(--cyan)', label }: {
  value: string; options: string[]; onChange: (v: string) => void; accent?: string; label?: string;
}) {
  const next = (e: React.MouseEvent) => { e.stopPropagation(); onChange(options[(options.indexOf(value) + 1) % options.length]); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
      <button type="button" onClick={next} className="mono" title="Click to cycle"
        style={{ fontSize: 10, fontWeight: 600, padding: '5px 10px', borderRadius: 6, color: accent,
          border: `1px solid ${cssVar(accent)}44`, background: `${cssVar(accent)}12`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {value}<span style={{ opacity: 0.5, fontSize: 8 }}>▾</span>
      </button>
    </div>
  );
}

// ── Horizontal slider (mix, cents, intensity) ──────────────────────────────
export function HSlider({ value, min, max, step, unit, label, accent = 'var(--cyan)', onChange, dim = false, width = '100%' }: {
  value: number; min: number; max: number; step?: number | undefined; unit?: Unit | undefined; label?: string;
  accent?: string; onChange: (v: number) => void; dim?: boolean | undefined; width?: string | number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const t = (value - min) / (max - min);
  const acc = dim ? 'var(--muted)' : accent;
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const set = (ev: PointerEvent | React.PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      let nv = min + Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * (max - min);
      if (step) nv = Math.round(nv / step) * step;
      onChange(Math.round(nv * 1e6) / 1e6);
    };
    set(e);
    const move = (ev: PointerEvent) => set(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width }}>
      {(label || unit !== undefined) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
          {unit !== undefined && <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--text-2)' }}>{fmtVal(unit, value)}</span>}
        </div>
      )}
      <div ref={ref} onPointerDown={onDown} className="lr-ctl"
        {...sliderA11y({ value, min, max, step, label, onChange, orientation: 'horizontal' })}
        style={{ position: 'relative', height: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', touchAction: 'none' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, border: '1px solid var(--border)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${t * 100}%`, height: 4, background: acc, borderRadius: 2, boxShadow: dim ? 'none' : `0 0 6px ${cssVar(accent)}55` }} />
        <div style={{ position: 'absolute', left: `${t * 100}%`, width: 12, height: 12, borderRadius: '50%', transform: 'translateX(-50%)', background: acc, boxShadow: dim ? 'none' : `0 0 6px ${cssVar(accent)}` }} />
      </div>
    </div>
  );
}

// ── Vertical fader ──────────────────────────────────────────────────────────
export function Fader({ value, min, max, step, unit, label, accent = 'var(--cyan)', height = 110, onChange, dim = false }: {
  value: number; min: number; max: number; step?: number | undefined; unit?: Unit | undefined; label?: string;
  accent?: string; height?: number; onChange?: (v: number) => void; dim?: boolean | undefined;
}) {
  const drag = useDragValue({ value, min, max, step, onChange: onChange || (() => {}), range: height });
  const t = (value - min) / (max - min);
  const acc = dim ? 'var(--muted)' : accent;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, userSelect: 'none' }}>
      <div ref={drag.ref} onPointerDown={drag.onPointerDown} className="lr-ctl"
        {...sliderA11y({ value, min, max, step, label, onChange: onChange || (() => {}), orientation: 'vertical' })}
        style={{ position: 'relative', width: 26, height, cursor: 'ns-resize', touchAction: 'none' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 4, transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.06)', borderRadius: 2, border: '1px solid var(--border)' }} />
        <div style={{ position: 'absolute', left: '50%', bottom: 0, width: 4, height: `${t * 100}%`, transform: 'translateX(-50%)', background: acc, borderRadius: 2, boxShadow: dim ? 'none' : `0 0 6px ${cssVar(accent)}66` }} />
        <div style={{ position: 'absolute', left: '50%', bottom: `calc(${t * 100}% - 7px)`, transform: 'translateX(-50%)', width: 22, height: 13, borderRadius: 3, background: 'var(--card-2)', border: `1px solid ${acc}`, boxShadow: dim ? 'none' : `0 0 8px ${cssVar(accent)}55, inset 0 1px 0 rgba(255,255,255,0.15)` }} />
      </div>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
      {unit !== undefined && <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--text-2)' }}>{fmtVal(unit, value)}</span>}
    </div>
  );
}

// ── Gain-reduction meter (comp / gate / limiter) ───────────────────────────
export function GRMeter({ reductionDb = 0, open, height = 110, vertical = true, label = 'GR' }: {
  reductionDb?: number; open?: boolean | undefined; height?: number; vertical?: boolean; label?: string;
}) {
  const t = Math.max(0, Math.min(1, -reductionDb / 20));
  if (!vertical) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: 8.5, color: 'var(--muted)', letterSpacing: '0.1em' }}>{label}</span>
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: t > 0.01 ? 'var(--orange)' : 'var(--muted)' }}>{reductionDb <= -0.05 ? `${reductionDb.toFixed(1)} dB` : '0.0 dB'}</span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${t * 100}%`, background: 'linear-gradient(90deg, var(--orange), var(--red))', borderRadius: 2 }} />
        </div>
      </div>
    );
  }
  const SEG = 16;
  const lit = Math.round(t * SEG);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 2, height, width: 14 }}>
        {Array.from({ length: SEG }).map((_, i) => (
          <div key={i} style={{ flex: 1, borderRadius: 1, background: i < lit ? (i > SEG - 4 ? 'var(--red)' : 'var(--orange)') : 'rgba(255,255,255,0.05)', boxShadow: i < lit && i >= lit - 1 ? '0 0 5px var(--orange)' : 'none' }} />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: t > 0.01 ? 'var(--orange)' : 'var(--muted)' }}>{reductionDb <= -0.05 ? reductionDb.toFixed(1) : '0.0'}</span>
      <span className="mono" style={{ fontSize: 7.5, color: 'var(--muted)', letterSpacing: '0.12em' }}>{open != null ? (open ? 'OPEN' : 'SHUT') : label}</span>
    </div>
  );
}

// ── Module glyph badge ─────────────────────────────────────────────────────
export function ModuleIcon({ glyph, accent, on, size = 28 }: {
  glyph: string; accent: string; on: boolean; size?: number;
}) {
  return (
    <div style={{ width: size, height: size, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center',
      fontFamily: 'JetBrains Mono, monospace', fontSize: size * 0.46, fontWeight: 700,
      color: on ? accent : 'var(--muted)',
      background: on ? `${cssVar(accent)}1a` : 'rgba(255,255,255,0.025)',
      border: `1px solid ${on ? `${cssVar(accent)}55` : 'var(--border)'}`,
      boxShadow: on ? `0 0 10px ${cssVar(accent)}33, inset 0 0 8px ${cssVar(accent)}14` : 'none', transition: 'all .15s' }}>{glyph}</div>
  );
}

// ── Handle-binding tag (handoff annotation; toggled by "Bindings" switch) ──
export function BindTag({ bind, show }: { bind: string; show: boolean }) {
  if (!show) return null;
  return (
    <div className="mono" style={{ fontSize: 8, color: 'var(--cyan)', letterSpacing: '0.02em', marginTop: 6,
      padding: '3px 7px', borderRadius: 5, background: 'rgba(0,229,176,0.05)', border: '1px dashed rgba(0,229,176,0.3)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      ⌁ graph.{bind}
    </div>
  );
}

// Worklet "initializing" pill (gate/bitcrusher/limiter post-load state)
export function WorkletPill({ ready }: { ready: boolean }) {
  return (
    <span className="mono" style={{ fontSize: 7.5, padding: '1px 6px', borderRadius: 4, letterSpacing: '0.08em',
      color: ready ? 'var(--green)' : 'var(--yellow)',
      border: `1px solid ${ready ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.32)'}`,
      background: ready ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)' }}>
      {ready ? 'WORKLET' : 'INIT…'}
    </span>
  );
}

// Generic param control dispatcher (renders the right widget for a descriptor)
export function ParamControl({ p, value, accent, onChange, dim, knobSize = 40 }: {
  p: ParamDescriptor; value: ParamValue; accent: string; onChange: (key: string, v: ParamValue) => void;
  dim?: boolean; knobSize?: number;
}) {
  const set = (v: ParamValue) => onChange(p.key, v);
  switch (p.control) {
    case 'knob':
    case 'knobBipolar':
      return <Knob label={p.label} value={value as number} min={p.min ?? 0} max={p.max ?? 1} step={p.step} unit={p.unit} accent={accent} size={knobSize} bipolar={p.control === 'knobBipolar'} onChange={set} dim={dim} hint={p.hint} />;
    case 'slider':
      return <HSlider label={p.label} value={value as number} min={p.min ?? 0} max={p.max ?? 1} step={p.step} unit={p.unit} accent={accent} onChange={set} dim={dim} />;
    case 'toggle':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{p.label}</span>
          <Switch on={!!value} onChange={set} accent={accent} size="sm" />
        </div>
      );
    case 'segmented':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{p.label}</span>
          <Segmented value={value as string} options={p.options ?? []} onChange={set} accent={accent} />
        </div>
      );
    case 'select':
      return <SelectChip label={p.label} value={value as string} options={p.options ?? []} onChange={set} accent={accent} />;
    default:
      return null;
  }
}

// ── Segmented bar (id/label options) ───────────────────────────────────────
export function SegBar({ value, options, onChange, accent = 'var(--cyan)', size = 'md' }: {
  value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; accent?: string; size?: 'sm' | 'md';
}) {
  const fs = size === 'sm' ? 10 : 10.5, pad = size === 'sm' ? '5px 10px' : '6px 13px';
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button type="button" key={o.id} onClick={() => onChange(o.id)} className="mono" style={{ fontSize: fs, fontWeight: 700, letterSpacing: '0.04em', padding: pad, borderRadius: 6, color: value === o.id ? '#06151a' : 'var(--muted)', background: value === o.id ? accent : 'transparent', transition: 'color .15s, background .15s' }}>{o.label}</button>
      ))}
    </div>
  );
}

// ── Rainbow hue slider (color control for visual effects) ──────────────────
export function HueSlider({ value, onChange, label }: {
  value: number; onChange: (h: number) => void; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: PointerEvent | React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onChange(Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360)));
  };
  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    set(e);
    const mv = (ev: PointerEvent) => set(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
      <div ref={ref} onPointerDown={down} className="lr-ctl"
        {...sliderA11y({ value, min: 0, max: 360, step: 1, label: label ?? 'Hue', onChange, orientation: 'horizontal' })}
        style={{ position: 'relative', height: 14, borderRadius: 7, cursor: 'pointer', touchAction: 'none', background: 'linear-gradient(90deg,hsl(0,80%,60%),hsl(60,80%,60%),hsl(120,80%,60%),hsl(180,80%,60%),hsl(240,80%,60%),hsl(300,80%,60%),hsl(360,80%,60%))' }}>
        <div style={{ position: 'absolute', top: '50%', left: `${value / 360 * 100}%`, width: 14, height: 14, borderRadius: '50%', transform: 'translate(-50%,-50%)', background: hslToHex(value), border: '2px solid #fff', boxShadow: '0 0 6px rgba(0,0,0,0.5)' }} />
      </div>
    </div>
  );
}
