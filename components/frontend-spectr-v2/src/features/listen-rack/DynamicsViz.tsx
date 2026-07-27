/* Ableton-style scrolling dynamics display for comp / gate / limiter:
 * input-level history (filled), output-level trace (line), gain reduction
 * hanging from the top on the same dB scale, and a draggable threshold /
 * ceiling line. Data comes from the device I/O analyser taps (readDeviceIo)
 * plus the unit's GR meter (readEffectMeter) — canvas drawn imperatively in
 * its own rAF loop; nothing routes through React state per frame. */
import { useEffect, useRef } from 'react';

import type { EffectId } from '../listen/audio/EffectUnit';
import type { RackGraphBindings } from './rackBindings';
import { lrClamp } from './lrUtil';

const FLOOR_DB = -60;
const HISTORY = 440; // samples ≈ px; ~7s at 60fps

const cssColor = (v: string): string =>
  v.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#eab308'
    : v;

export interface DynamicsVizProps {
  graph: RackGraphBindings | null;
  id: EffectId;
  playing: boolean;
  dim: boolean;
  accent: string;
  /** The draggable line: comp/gate threshold, limiter ceiling. */
  thresholdDb: number;
  thresholdMin: number;
  thresholdMax: number;
  thresholdLabel: string;
  onThreshold: (db: number) => void;
}

export function DynamicsViz({
  graph, id, playing, dim, accent,
  thresholdDb, thresholdMin, thresholdMax, thresholdLabel, onThreshold,
}: DynamicsVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const bufIn = useRef(new Float32Array(HISTORY).fill(FLOOR_DB));
  const bufOut = useRef(new Float32Array(HISTORY).fill(FLOOR_DB));
  const bufGr = useRef(new Float32Array(HISTORY));
  const head = useRef(0);
  const thrRef = useRef(thresholdDb);
  thrRef.current = thresholdDb;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return undefined;
    const acc = cssColor(accent);
    const orange = cssColor('var(--orange)');
    const dpr = window.devicePixelRatio || 1;

    const yOf = (db: number, h: number) => ((0 - lrClamp(db, FLOOR_DB, 0)) / -FLOOR_DB) * h;

    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      // sample
      if (playing) {
        let level: { inDb: number; outDb: number } | null = null;
        let gr = 0;
        if (graph?.tapDeviceIo && graph.readDeviceIo) {
          graph.tapDeviceIo(id); // idempotent; covers the lazily-created ctx
          level = graph.readDeviceIo();
          gr = Math.abs(graph.readEffectMeter(id)?.reductionDb ?? 0);
        } else if (!graph) {
          // mock route: synthetic program material
          const t = (performance.now() - t0) / 1000;
          const inDb = -20 + 7 * Math.sin(t * 2.1) + 3 * Math.sin(t * 5.7);
          gr = Math.max(0, (inDb - thrRef.current) * 0.5);
          level = { inDb, outDb: inDb - gr };
        }
        const i = head.current;
        bufIn.current[i] = Number.isFinite(level?.inDb ?? NaN) ? (level as { inDb: number }).inDb : FLOOR_DB;
        bufOut.current[i] = Number.isFinite(level?.outDb ?? NaN) ? (level as { outDb: number }).outDb : FLOOR_DB;
        bufGr.current[i] = gr;
        head.current = (i + 1) % HISTORY;
      }

      // draw
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) { raf = requestAnimationFrame(tick); return; }
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);

      // grid
      ctx2d.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx2d.lineWidth = 1;
      for (const db of [-12, -24, -36, -48]) {
        const y = yOf(db, h);
        ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(w, y); ctx2d.stroke();
      }

      const at = (buf: Float32Array, k: number) => buf[(head.current + k) % HISTORY];
      const xOf = (k: number) => (k / (HISTORY - 1)) * w;

      // input area (dark fill from the bottom)
      ctx2d.beginPath();
      ctx2d.moveTo(0, h);
      for (let k = 0; k < HISTORY; k++) ctx2d.lineTo(xOf(k), yOf(at(bufIn.current, k), h));
      ctx2d.lineTo(w, h);
      ctx2d.closePath();
      ctx2d.globalAlpha = dim ? 0.12 : 0.25;
      ctx2d.fillStyle = acc;
      ctx2d.fill();
      ctx2d.globalAlpha = 1;

      // output trace
      ctx2d.beginPath();
      for (let k = 0; k < HISTORY; k++) {
        const x = xOf(k); const y = yOf(at(bufOut.current, k), h);
        if (k === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
      }
      ctx2d.strokeStyle = acc;
      ctx2d.globalAlpha = dim ? 0.4 : 1;
      ctx2d.lineWidth = 1.6;
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;

      // gain reduction hanging from the top (same dB scale)
      ctx2d.beginPath();
      ctx2d.moveTo(0, 0);
      for (let k = 0; k < HISTORY; k++) ctx2d.lineTo(xOf(k), (at(bufGr.current, k) / -FLOOR_DB) * h);
      ctx2d.lineTo(w, 0);
      ctx2d.closePath();
      ctx2d.globalAlpha = dim ? 0.25 : 0.6;
      ctx2d.fillStyle = orange;
      ctx2d.fill();
      ctx2d.globalAlpha = 1;

      // threshold / ceiling line
      const ty = yOf(thrRef.current, h);
      ctx2d.setLineDash([5, 4]);
      ctx2d.strokeStyle = dim ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.75)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath(); ctx2d.moveTo(0, ty); ctx2d.lineTo(w, ty); ctx2d.stroke();
      ctx2d.setLineDash([]);

      // live readout
      const i0 = (head.current - 1 + HISTORY) % HISTORY;
      if (readoutRef.current) {
        const gr = bufGr.current[i0];
        const out = bufOut.current[i0];
        readoutRef.current.textContent =
          `${thresholdLabel} ${thrRef.current.toFixed(1)} dB · GR ${gr.toFixed(1)} dB · OUT ${out <= FLOOR_DB ? '−∞' : out.toFixed(1)} dB`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph, id, playing, dim, accent, thresholdLabel]);

  const startDrag = (e: React.PointerEvent) => {
    if (dim) return;
    e.preventDefault();
    const apply = (clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const db = ((rect.top - clientY) / rect.height) * -FLOOR_DB; // top=0, bottom=FLOOR
      onThreshold(Math.round(lrClamp(db, thresholdMin, thresholdMax) * 2) / 2);
    };
    apply(e.clientY);
    const move = (ev: PointerEvent) => apply(ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="lr-dyn">
      <div className="lr-dyn-h mono">
        <span ref={readoutRef} />
        <span className="hint">drag = {thresholdLabel.toLowerCase()}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="lr-dyn-c"
        onPointerDown={startDrag}
        title={`Input (fill) · output (line) · gain reduction (top) — drag to set the ${thresholdLabel.toLowerCase()}`}
      />
    </div>
  );
}
