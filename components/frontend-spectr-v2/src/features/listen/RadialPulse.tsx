import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import s from './RadialPulse.module.css';

// Radial-pulse visualizer (Canvas 2D). Points fan out around a circle, each
// radius modulated by the matching spectrum bar; ripples spawn on detected
// beats and expand outward. Driven by the page's single rAF loop via the
// imperative `draw()` handle — this component owns NO loop of its own (matches
// the "one shared rAF loop, never setState per frame" contract).

export interface RadialPulseHandle {
  /**
   * Render one frame.
   * @param values  spectrum bars 0..1 (any length; sampled around the circle)
   * @param pulse   0..1 beat envelope (drives the core glow)
   * @param beat    true on the frame a beat onset fired (spawns a ripple)
   * @param color   ring/point color (hex)
   * @param energyMul global energy macro multiplier (0..2)
   */
  draw: (values: number[], pulse: number, beat: boolean, color: string, energyMul: number) => void;
  clear: () => void;
}

interface Ripple {
  r: number; // current radius (px, css units)
  life: number; // 1 → 0
}

const TWO_PI = Math.PI * 2;

export const RadialPulse = forwardRef<RadialPulseHandle>(function RadialPulse(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);

  const sizeCanvas = (canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: rect.width, h: rect.height, dpr };
  };

  useImperativeHandle(ref, () => ({
    draw(values, pulse, beat, color, energyMul) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const { w, h, dpr } = sizeCanvas(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.18;
      const reach = Math.min(w, h) * 0.32 * Math.max(0.2, energyMul);

      // Bass = average of the lowest bars; drives the breathing core radius.
      const n = values.length;
      let bass = 0;
      const bassN = Math.max(1, Math.floor(n * 0.12));
      for (let i = 0; i < bassN; i += 1) bass += values[i] ?? 0;
      bass /= bassN;
      const coreR = baseR * (1 + bass * 0.5 * energyMul) + pulse * baseR * 0.4;

      // Spawn + step ripples.
      if (beat) ripplesRef.current.push({ r: coreR, life: 1 });
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const rp = ripples[i];
        rp.r += (reach * 0.06 + 2) * Math.max(0.4, energyMul);
        rp.life -= 0.02;
        if (rp.life <= 0 || rp.r > Math.max(w, h)) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = rp.life * 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rp.r, 0, TWO_PI);
        ctx.stroke();
      }

      // Radial points: one per sampled bar around the circle.
      const points = Math.min(96, Math.max(24, n));
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      for (let i = 0; i < points; i += 1) {
        const t = i / points;
        const v = values[Math.floor(t * n)] ?? 0;
        const ang = t * TWO_PI - Math.PI / 2;
        const r = coreR + v * reach;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        const dot = 1.4 + v * 3.2 * Math.max(0.4, energyMul);
        ctx.beginPath();
        ctx.arc(px, py, dot, 0, TWO_PI);
        ctx.fill();
      }

      // Core glow.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    clear() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      ripplesRef.current = [];
    },
  }), []);

  // Clear ripple state on unmount (no rAF to cancel — the page owns the loop).
  useEffect(() => () => { ripplesRef.current = []; }, []);

  return <canvas ref={canvasRef} className={s.canvas} aria-hidden />;
});
