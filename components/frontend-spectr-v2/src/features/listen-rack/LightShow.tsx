/* Listen Rack v2 — page-wide "light show" atmosphere layer: 4 oscillating
 * laser beams, perspective floor grid, drifting dust motes, hue-cycling haze.
 * Fixed full-viewport canvas at z-0 (the .wrap content sits at z-1). Dims to
 * 35% when paused. Ported from the design handoff (lr-stage.jsx → LightShow). */
import { useEffect, useRef } from 'react';

export function LightShow({ playing, intensity = 1, show, gridHue = 168, gridIntensity = 50 }: {
  playing: boolean; intensity?: number; show: boolean;
  /** Floor grid hue (0-360) + intensity (0-100; 50 = classic, 0 = hidden). */
  gridHue?: number | undefined; gridIntensity?: number | undefined;
}) {
  const cv = useRef<HTMLCanvasElement | null>(null);
  const pr = useRef({ playing, intensity, gridHue, gridIntensity });
  pr.current = { playing, intensity, gridHue, gridIntensity };
  useEffect(() => {
    if (!show) return undefined;
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return undefined;
    let raf = 0;
    const t0 = performance.now();
    const beams = [
      { h: 168, x: 0.06, base: 0.55, sw: 0.5, sp: 0.21, ph: 0 },
      { h: 275, x: 0.3, base: 0.2, sw: 0.65, sp: 0.15, ph: 2.1 },
      { h: 330, x: 0.68, base: -0.2, sw: 0.6, sp: 0.18, ph: 4.2 },
      { h: 200, x: 0.94, base: -0.55, sw: 0.5, sp: 0.24, ph: 1.3 },
    ];
    const dust = Array.from({ length: 70 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.5 + 0.4, s: Math.random() * 0.01 + 0.003, ph: Math.random() * 7,
    }));
    const draw = () => {
      const { playing: live0, intensity: I, gridHue: gh, gridIntensity: gi } = pr.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const t = (performance.now() - t0) / 1000;
      const live = live0 ? 1 : 0.35;
      const beat = live0 ? Math.pow(Math.max(0, Math.sin(t * Math.PI * (128 / 60))), 3) : 0;
      // haze wash
      const hz = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, H * 1.1);
      hz.addColorStop(0, `hsla(${190 + Math.sin(t * 0.13) * 40},80%,45%,${0.075 * I * live})`);
      hz.addColorStop(1, 'transparent');
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, W, H);
      // floor grid — hue + intensity are user settings (Visuals tab); 50 is
      // the classic 0.05 alpha, scaling linearly up to 2x at 100.
      const gridA = 0.05 * ((gi ?? 50) / 50) * I * live;
      if (gridA > 0.001) {
        const hy = H * 0.66;
        ctx.strokeStyle = `hsla(${gh ?? 168},90%,55%,${gridA})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const p = (t * 0.06 + i / 9) % 1;
          const y = hy + Math.pow(p, 2.6) * (H - hy);
          ctx.globalAlpha = p * 0.9;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let i = -7; i <= 7; i++) {
          ctx.beginPath();
          ctx.moveTo(W * 0.5 + i * 26, hy);
          ctx.lineTo(W * 0.5 + i * W * 0.12, H);
          ctx.stroke();
        }
      }
      // lasers
      ctx.globalCompositeOperation = 'lighter';
      beams.forEach((b) => {
        const a = b.base + Math.sin(t * b.sp * (live0 ? 1 : 0.4) + b.ph) * b.sw;
        const x0 = b.x * W;
        const L = H * 1.5;
        const al = (0.10 + beat * 0.12) * I * live;
        ctx.save();
        ctx.translate(x0, -12);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, 0, L);
        g.addColorStop(0, `hsla(${b.h},100%,62%,${al})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-1.5, 0); ctx.lineTo(1.5, 0); ctx.lineTo(26, L); ctx.lineTo(-26, L);
        ctx.closePath(); ctx.fill();
        const core = ctx.createLinearGradient(0, 0, 0, L);
        core.addColorStop(0, `hsla(${b.h},100%,72%,${al * 2.4})`);
        core.addColorStop(1, 'transparent');
        ctx.strokeStyle = core;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, L); ctx.stroke();
        ctx.restore();
        const sg = ctx.createRadialGradient(x0, 0, 0, x0, 0, 46);
        sg.addColorStop(0, `hsla(${b.h},100%,65%,${al * 2})`);
        sg.addColorStop(1, 'transparent');
        ctx.fillStyle = sg;
        ctx.fillRect(x0 - 46, -46, 92, 92);
      });
      // dust
      ctx.fillStyle = `hsla(190,60%,80%,${0.16 * I * live})`;
      dust.forEach((d) => {
        d.y -= d.s / 10;
        if (d.y < 0) d.y = 1;
        const x = (d.x + Math.sin(t * 0.3 + d.ph) * 0.012) * W;
        ctx.globalAlpha = (0.3 + 0.7 * Math.abs(Math.sin(t * 0.8 + d.ph))) * 0.5;
        ctx.beginPath(); ctx.arc(x, d.y * H, d.r, 0, 7); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [show]);
  return show ? <canvas className="lr-bgfx" ref={cv} /> : null;
}
