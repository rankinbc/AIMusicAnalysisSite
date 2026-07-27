/* Listen Rack v2 — shared control primitives (switch, sliders, segmented,
 * select, toggle, EQ strip) ported from the design handoff (lr-ui.jsx).
 * Class names come from listen-rack-v2.css (scoped under .rdx). */
import { useRef } from 'react';

import { fmtVal, type EqBand, type ParamDescriptor, type ParamValue } from './data';
import { lrDrag } from './lrUtil';

// ── Switch ────────────────────────────────────────────────────────────
export function Sw({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      className={'lr-sw' + (on ? ' on' : '')}
      title={title}
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
    />
  );
}

// ── Horizontal param slider ───────────────────────────────────────────
export function PSlider({ label, value, min, max, step, unit, onChange, wide }: {
  label: string; value: number; min: number; max: number; step?: number | undefined;
  unit?: string | undefined; onChange: (v: number) => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;
  const set = (t: number) => {
    let v = min + t * (max - min);
    if (step) v = Math.round(v / step) * step;
    onChange(+v.toFixed(4));
  };
  return (
    <div className={'lr-pc' + (wide ? ' wide' : '')}>
      <div className="lr-pc-l"><span className="k">{label}</span><span className="v">{fmtVal(unit, value)}</span></div>
      <div
        className="lr-sl"
        ref={ref}
        onPointerDown={(e) => { e.preventDefault(); if (ref.current) lrDrag(ref.current, e, set); }}
      >
        <div className="tk"><div className="fl" style={{ width: pct + '%' }} /><div className="th" style={{ left: pct + '%' }} /></div>
      </div>
    </div>
  );
}

// ── Segmented / select / toggle param controls ─────────────────────────
export function PSeg({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="lr-pc" style={{ width: 'auto' }}>
      <div className="lr-pc-l"><span className="k">{label}</span></div>
      <div className="lr-seg">
        {options.map((o) => (
          <button type="button" key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
}

export function PSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="lr-pc" style={{ width: 'auto' }}>
      <div className="lr-pc-l"><span className="k">{label}</span></div>
      <select className="lr-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function PToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return <label className="lr-tg">{label}<Sw on={!!value} onChange={onChange} /></label>;
}

/** One manifest param → the matching control (the `control:` kind decides). */
export function ParamControl({ p, value, onChange }: {
  p: ParamDescriptor; value: ParamValue; onChange: (v: ParamValue) => void;
}) {
  if (p.control === 'toggle') return <PToggle label={p.label} value={Boolean(value)} onChange={onChange} />;
  if (p.control === 'select') {
    return <PSelect label={p.label} value={String(value)} options={p.options ?? []} onChange={onChange} />;
  }
  if (p.control === 'segmented') {
    return <PSeg label={p.label} value={String(value)} options={p.options ?? []} onChange={onChange} />;
  }
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  return (
    <PSlider
      label={p.label}
      value={Number(value) || 0}
      min={min}
      max={max}
      step={p.step ?? (max - min) / 100}
      unit={p.unit}
      onChange={onChange}
      wide={p.control === 'slider'}
    />
  );
}

// ── EQ band strip (8 vertical gain faders) ─────────────────────────────
function EqBandCol({ b, onChange }: { b: EqBand; onChange: (patch: Partial<EqBand>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = (b.gainDb + 24) / 48;
  const top = Math.max(t, 0.5);
  const bot = Math.min(t, 0.5);
  return (
    <div className={'lr-eqb' + (b.enabled ? '' : ' off')}>
      <span className="g">{b.gainDb > 0 ? '+' : ''}{b.gainDb.toFixed(1)}</span>
      <div
        className="vs"
        ref={ref}
        onPointerDown={(e) => {
          e.preventDefault();
          if (ref.current) lrDrag(ref.current, e, (v) => onChange({ gainDb: +(v * 48 - 24).toFixed(1) }), true);
        }}
        onDoubleClick={() => onChange({ gainDb: 0 })}
        title={`${b.freq} Hz · ${b.type} · double-click to zero`}
      >
        <div className="vt">
          <div className="vf" style={{ bottom: bot * 100 + '%', height: (top - bot) * 100 + '%' }} />
          <div className="vh" style={{ bottom: t * 100 + '%' }} />
        </div>
      </div>
      <span className="f">{b.freq >= 1000 ? b.freq / 1000 + 'k' : b.freq}</span>
      <Sw on={b.enabled} onChange={(v) => onChange({ enabled: v })} title="band on/off" />
    </div>
  );
}

export function EqStrip({ bands, setBand }: {
  bands: EqBand[]; setBand: (i: number, patch: Partial<EqBand>) => void;
}) {
  return (
    <div className="lr-eq">
      {bands.map((b, i) => <EqBandCol key={i} b={b} onChange={(p) => setBand(i, p)} />)}
    </div>
  );
}
