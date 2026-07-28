/* Ableton-EQ-Eight-style parametric editor for the rack EQ: combined response
 * curve on a log-frequency / dB grid, one draggable numbered dot per band
 * (drag = freq + gain; wheel = Q), and a per-band strip (type / gain / Q /
 * on-off) for the selected band. Pure UI over the existing EqBand[] model —
 * the engine already applies type/freq/Q per band (audio/effects/eq.ts). */
import { useMemo, useRef, useState } from 'react';

import type { EqBand } from './data';
import { bandResponseDb, logFreqs, sumResponseDb } from './eqResponse';
import { PSlider, Sw } from './lrControls';
import { lrClamp } from './lrUtil';

const W = 460;
const H = 168;
const RANGE_DB = 15;
const FMIN = 20;
const FMAX = 20000;

const xOf = (f: number) => (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * W;
const fOf = (x: number) => FMIN * Math.pow(FMAX / FMIN, lrClamp(x, 0, W) / W);
const yOf = (db: number) => H / 2 - (lrClamp(db, -RANGE_DB, RANGE_DB) / RANGE_DB) * (H / 2 - 8);
const dbOf = (y: number) => -((y - H / 2) / (H / 2 - 8)) * RANGE_DB;

const isFilter = (t: string) => t === 'highpass' || t === 'lowpass';

const TYPE_OPTIONS: Array<{ v: string; label: string }> = [
  { v: 'peaking', label: 'Bell' },
  { v: 'lowshelf', label: 'Low Shelf' },
  { v: 'highshelf', label: 'High Shelf' },
  { v: 'highpass', label: 'High-pass' },
  { v: 'lowpass', label: 'Low-pass' },
];

const GRID_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f < 10000 ? 1 : 0)}k` : String(Math.round(f)));

export function EqCurveEditor({ bands, accent, dim, onBands }: {
  bands: EqBand[];
  accent: string;
  dim: boolean;
  onBands: (next: EqBand[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState(0);
  const patch = (i: number, bp: Partial<EqBand>) =>
    onBands(bands.map((b, k) => (k === i ? { ...b, ...bp } : b)));

  const curve = useMemo(() => {
    const freqs = logFreqs(140);
    const dbs = sumResponseDb(bands, freqs);
    const pts = freqs.map((f, i) => `${xOf(f).toFixed(1)},${yOf(dbs[i]).toFixed(1)}`);
    return {
      line: `M ${pts.join(' L ')}`,
      area: `M ${xOf(freqs[0]).toFixed(1)},${yOf(0)} L ${pts.join(' L ')} L ${xOf(freqs[freqs.length - 1]).toFixed(1)},${yOf(0)} Z`,
    };
  }, [bands]);

  // Drag handlers read the freshest bands via a ref (state lags pointermove).
  const bandsRef = useRef(bands);
  bandsRef.current = bands;

  // NOTE: editing is NOT gated on the module being enabled (`dim` only dims
  // the visuals) — knobs/faders everywhere stay editable while a module is
  // off, and gating the dots made dragging silently die whenever the EQ
  // toggle or master BYPASS was engaged.
  const startDrag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSel(i);
    const move = (ev: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = ((ev.clientX - rect.left) / rect.width) * W;
      const y = ((ev.clientY - rect.top) / rect.height) * H;
      const freq = Math.round(lrClamp(fOf(x), FMIN, FMAX));
      const b = bandsRef.current[i];
      if (!b) return;
      if (isFilter(b.type)) patch(i, { freq }); // filters: cutoff only
      else patch(i, { freq, gainDb: Math.round(lrClamp(dbOf(y), -RANGE_DB, RANGE_DB) * 10) / 10 });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (i: number) => (e: React.WheelEvent) => {
    setSel(i);
    const b = bands[i];
    if (!b) return;
    const q = lrClamp(b.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.1, 18);
    patch(i, { q: Math.round(q * 100) / 100 });
  };

  const selBand = bands[sel];
  const acc = dim ? 'var(--muted)' : accent;

  return (
    <div className="lr-eqc">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="lr-eqc-g"
        onPointerDown={() => { /* background click keeps selection */ }}
      >
        {/* grid */}
        {GRID_FREQS.map((f) => (
          <line key={f} x1={xOf(f)} y1={0} x2={xOf(f)} y2={H} className="gv" />
        ))}
        {[-12, -6, 0, 6, 12].map((db) => (
          <line key={db} x1={0} y1={yOf(db)} x2={W} y2={yOf(db)} className={db === 0 ? 'gz' : 'gh'} />
        ))}
        {[100, 1000, 10000].map((f) => (
          <text key={f} x={xOf(f) + 3} y={H - 4} className="gt">{fmtHz(f)}</text>
        ))}
        {[-12, -6, 6, 12].map((db) => (
          <text key={db} x={3} y={yOf(db) - 3} className="gt">{db > 0 ? `+${db}` : db}</text>
        ))}
        {/* combined response */}
        <path d={curve.area} fill={acc} opacity={0.10} />
        <path d={curve.line} fill="none" stroke={acc} strokeWidth={1.8}
          style={dim ? undefined : { filter: `drop-shadow(0 0 5px ${accent})` }} />
        {/* band dots */}
        {bands.map((b, i) => {
          const y = isFilter(b.type) ? yOf(bandResponseDb(b, b.freq)) : yOf(b.gainDb);
          return (
            <g
              key={i}
              className={'bd' + (i === sel ? ' sel' : '') + (b.enabled ? '' : ' off')}
              transform={`translate(${xOf(b.freq)}, ${y})`}
              onPointerDown={startDrag(i)}
              onWheel={onWheel(i)}
            >
              <circle r={8} className="bh" />
              <circle r={6.5} className="bc" style={{ stroke: acc, fill: i === sel ? acc : 'var(--bg-2, #0c1220)' }} />
              <text y={2.8} className="bn" style={{ fill: i === sel ? 'var(--bg-2, #0c1220)' : acc }}>{i + 1}</text>
            </g>
          );
        })}
      </svg>
      {selBand && (
        <div className="lr-eqc-row">
          <span className="mono bnum" style={{ color: acc }}>#{sel + 1}</span>
          <select
            className="lr-sel"
            value={selBand.type}
            onChange={(e) => {
              const t = e.target.value;
              patch(sel, { type: t, ...(isFilter(t) ? { gainDb: 0 } : {}) });
            }}
            title="Band type"
          >
            {TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <span className="mono bfrq" title="Drag the dot to set frequency">{fmtHz(selBand.freq)}Hz</span>
          {!isFilter(selBand.type) && (
            <PSlider
              label="gain"
              value={selBand.gainDb}
              min={-RANGE_DB}
              max={RANGE_DB}
              step={0.1}
              unit="dB"
              onChange={(v) => patch(sel, { gainDb: Number(v) })}
            />
          )}
          <PSlider
            label="q"
            value={selBand.q}
            min={0.1}
            max={18}
            step={0.05}
            onChange={(v) => patch(sel, { q: Number(v) })}
          />
          <Sw on={selBand.enabled} onChange={(on) => patch(sel, { enabled: on })} title={`Band ${sel + 1} on/off`} />
        </div>
      )}
      <div className="mono lr-eqc-hint">drag dot = freq / gain · scroll on dot = Q · filters (HP/LP) drag = cutoff</div>
    </div>
  );
}
