/* Listen Rack v2 — device bay: rack-hardware editor panel for the selected
 * module (rotary knobs, vertical EQ faders, segmented LED GR meter). Ported
 * from the design handoff (lr-devices.jsx), wired to RackState. */
import { useRef } from 'react';

import { Icon } from '../results/Icon';
import type { ModuleManifest, ParamValue } from './data';
import { fmtVal, type EqBand } from './data';
import { ParamControl, PSlider, PToggle, Sw } from './lrControls';
import { lrClamp } from './lrUtil';
import { useDeviceIo, useGainReduction, type DeviceIoState, type RackState } from './rackState';

const lrCssVar = (v: string): string =>
  v.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#00e5b0'
    : v;

function useDragValue({ value, min, max, step, onChange, range = 170 }: {
  value: number; min: number; max: number; step?: number | undefined;
  onChange: (v: number) => void; range?: number;
}) {
  const start = useRef<{ y: number; v: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    start.current = { y: e.clientY, v: value };
    const move = (ev: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const dv = ((s.y - ev.clientY) / range) * (max - min);
      let nv = lrClamp(s.v + dv, min, max);
      if (step) nv = Math.round(nv / step) * step;
      onChange(+nv.toFixed(4));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { onPointerDown };
}

// ── Rotary knob ────────────────────────────────────────────────────────
function LRKnob({ value, min, max, step, unit, label, accent, size = 38, bipolar, onChange, dim, hint }: {
  value: number; min: number; max: number; step?: number | undefined; unit?: string | undefined;
  label: string; accent: string; size?: number; bipolar?: boolean;
  onChange: (v: number) => void; dim: boolean; hint?: string | undefined;
}) {
  const drag = useDragValue({ value, min, max, step, onChange });
  const t = (value - min) / (max - min);
  const A0 = -135;
  const A1 = 135;
  const ang = A0 + t * (A1 - A0);
  const r = size / 2;
  const tr = r - 3.5;
  const polar = (deg: number, rad: number): [number, number] => [
    r + rad * Math.cos(((deg - 90) * Math.PI) / 180),
    r + rad * Math.sin(((deg - 90) * Math.PI) / 180),
  ];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = polar(a0, tr);
    const [x1, y1] = polar(a1, tr);
    return `M ${x0} ${y0} A ${tr} ${tr} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`;
  };
  const acc = dim ? 'var(--muted)' : accent;
  const [px, py] = polar(ang, tr - 1);
  const [ix, iy] = polar(ang, tr - size * 0.3);
  return (
    <div className="lr-knob">
      <span className="kl">{label}</span>
      <div
        className="kb"
        onPointerDown={drag.onPointerDown}
        title={hint || 'drag vertically'}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size}>
          <circle cx={r} cy={r} r={tr} fill="url(#lrkg)" stroke="var(--border-2)" />
          <path d={arc(A0, A1)} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" strokeLinecap="round" />
          <path
            d={arc(bipolar ? 0 : A0, ang)}
            fill="none"
            stroke={acc}
            strokeWidth="3"
            strokeLinecap="round"
            style={{ filter: dim ? 'none' : `drop-shadow(0 0 4px ${lrCssVar(accent)}88)` }}
          />
          <line x1={ix} y1={iy} x2={px} y2={py} stroke={acc} strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <span className="kv" style={{ color: dim ? 'var(--muted)' : 'var(--text-2)' }}>{fmtVal(unit, value)}</span>
    </div>
  );
}

// ── Vertical fader (EQ bands) ──────────────────────────────────────────
function LRFader({ value, min, max, step, label, unit, accent, height = 74, onChange, dim, fmt }: {
  value: number; min: number; max: number; step?: number | undefined; label: string;
  unit?: string | undefined; accent: string; height?: number;
  onChange: (v: number) => void; dim: boolean; fmt?: (v: number) => string;
}) {
  const drag = useDragValue({ value, min, max, step, onChange, range: height * 1.6 });
  const t = (value - min) / (max - min);
  const acc = dim ? 'var(--muted)' : accent;
  return (
    <div className="lr-fad">
      <span className="fv">{fmt ? fmt(value) : fmtVal(unit, value)}</span>
      <div className="fb" onPointerDown={drag.onPointerDown} style={{ height }}>
        <span className="ft" />
        <span className="ff" style={{ height: t * 100 + '%', background: acc }} />
        <span className="fh" style={{ bottom: `calc(${t * 100}% - 6px)`, borderColor: acc }} />
      </div>
      <span className="fl">{label}</span>
    </div>
  );
}

// ── GR meter (comp / gate / limiter) ───────────────────────────────────
function LRGr({ gr, height = 78 }: { gr: number; height?: number }) {
  const t = lrClamp(gr / 8, 0, 1);
  return (
    <div className="lr-grm">
      <div className="gt" style={{ height }}><span style={{ height: t * 100 + '%' }} /></div>
      <span className="gl">GR</span>
    </div>
  );
}

// ── IN/OUT level meters (signal into / out of the selected device) ─────
function LRIo({ io, height = 78 }: { io: DeviceIoState | null; height?: number }) {
  // Meter range −60..+6 dBFS RMS.
  const t = (db: number) => lrClamp((db + 60) / 66, 0, 1);
  const fmt = (db: number) => (db <= -60 ? '−∞' : db.toFixed(1));
  const bar = (label: string, db: number) => (
    <div className="iob" key={label}>
      <div className="it" style={{ height }} title={`${label} ${fmt(db)} dBFS (RMS)`}>
        <span style={{ height: t(db) * 100 + '%' }} />
      </div>
      <span className="il">{label}</span>
      <span className="iv">{fmt(db)}</span>
    </div>
  );
  return (
    <div className="lr-iom">
      {bar('IN', io?.inDb ?? -60)}
      {bar('OUT', io?.outDb ?? -60)}
    </div>
  );
}

// ── The device bay ─────────────────────────────────────────────────────
export function DeviceBayV2({ m, i, rs, playing, showBind, onClose }: {
  m: ModuleManifest;
  /** Chain index (−1 for the pitch buffer lane). */
  i: number;
  rs: RackState;
  playing: boolean;
  showBind: boolean;
  onClose: () => void;
}) {
  const v = rs.mod[m.id];
  const grLive = useGainReduction(rs.graph, m.id, Boolean(v?.enabled) && m.hasMeter, playing);
  // IN/OUT taps: insert devices only (the pitch lane has i < 0 and no unit).
  const io = useDeviceIo(rs.graph, m.id, i >= 0, playing);
  if (!v) return null;
  const on = v.enabled && !rs.masterBypass;
  const dim = !on;
  const gr = Math.abs(grLive);
  const knob = 44;
  const params = m.params.filter((p) => p.key !== 'enabled');
  const sliders = params.filter((p) => p.control === 'slider');
  const knobs = params.filter((p) => p.control === 'knob' || p.control === 'knobBipolar');
  const enums = params.filter((p) => p.control === 'select' || p.control === 'segmented');
  const toggles = params.filter((p) => p.control === 'toggle');
  const patch = (key: string) => (nv: ParamValue) => rs.setParam(m.id, key, nv);
  const bands = (v['bands'] as EqBand[] | undefined) ?? [];
  const setBand = (bi: number, bp: Partial<EqBand>) =>
    rs.setEqBands(bands.map((b, k) => (k === bi ? { ...b, ...bp } : b)));
  return (
    <div className={'lr-bay open' + (on ? ' on' : '')} style={{ ['--mac' as string]: m.accent }}>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <radialGradient id="lrkg" cx="50%" cy="30%">
            <stop offset="0%" stopColor="#242c3d" />
            <stop offset="100%" stopColor="#141a28" />
          </radialGradient>
        </defs>
      </svg>
      <div className="lr-bay-h">
        <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
        <span className="lr-mc-t">
          <span className="lr-mc-n">{m.label}</span>
          <span className="lr-mc-s">
            {i < 0 ? 'buffer lane · not an insert' : '#' + String(i + 1).padStart(2, '0') + ' in chain'} · {m.sub}
          </span>
        </span>
        {m.worklet && <span className="wk" title="AudioWorklet — brief init">wk</span>}
        {showBind && <span className="lr-bind">{m.bind}</span>}
        <button
          type="button"
          className="lr-ib"
          title="Reset to neutral"
          onClick={(e) => { e.stopPropagation(); rs.resetModule(m.id); }}
        >
          <Icon name="refresh" size={13} />
        </button>
        <Sw on={v.enabled} onChange={(nv) => rs.setEnabled(m.id, nv)} />
        <button type="button" className="lr-ib" title="Close" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="lr-bay-b">
        {m.perBand ? (
          <div className="lr-bay-eq">
            {bands.map((b, bi) => (
              <LRFader
                key={bi}
                value={b.gainDb}
                min={-24}
                max={24}
                step={0.5}
                accent={m.accent}
                dim={dim}
                height={70}
                label={b.freq >= 1000 ? b.freq / 1000 + 'k' : String(b.freq)}
                fmt={(g) => (g > 0 ? '+' : '') + g.toFixed(1)}
                onChange={(g) => setBand(bi, { gainDb: g })}
              />
            ))}
          </div>
        ) : (
          <>
            {!!knobs.length && (
              <div className="lr-bay-row">
                {knobs.map((p) => (
                  <LRKnob
                    key={p.key}
                    label={p.label}
                    value={Number(v[p.key]) || 0}
                    min={p.min ?? 0}
                    max={p.max ?? 1}
                    step={p.step}
                    unit={p.unit}
                    accent={m.accent}
                    dim={dim}
                    size={knob}
                    bipolar={p.control === 'knobBipolar'}
                    hint={p.hint}
                    onChange={patch(p.key)}
                  />
                ))}
                {m.hasMeter && <LRGr gr={on ? gr : 0} height={knob + 34} />}
              </div>
            )}
            {!!enums.length && (
              <div className="lr-bay-row lr-wrap">
                {enums.map((p) => (
                  <ParamControl key={p.key} p={p} value={v[p.key] ?? p.default} onChange={patch(p.key)} />
                ))}
              </div>
            )}
            {sliders.map((p) => (
              <PSlider
                key={p.key}
                label={p.label}
                value={Number(v[p.key]) || 0}
                min={p.min ?? 0}
                max={p.max ?? 1}
                step={p.step}
                unit={p.unit}
                onChange={patch(p.key)}
                wide
              />
            ))}
            {!!toggles.length && (
              <div className="lr-bay-row lr-wrap">
                {toggles.map((p) => (
                  <PToggle key={p.key} label={p.label} value={Boolean(v[p.key])} onChange={patch(p.key)} />
                ))}
              </div>
            )}
          </>
        )}
        {i >= 0 && <LRIo io={io} height={knob + 26} />}
      </div>
    </div>
  );
}
