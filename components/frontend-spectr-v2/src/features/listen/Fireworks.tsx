import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { spawnBurst, stepParticles, type Particle } from './fireworksParticles';
import s from './Fireworks.module.css';

export interface FireworksHandle { launch: () => void; }

export const Fireworks = forwardRef<FireworksHandle>(function Fireworks(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const partsRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<Set<number>>(new Set());

  // useCallback with [] gives loop a stable identity across renders.
  // All state is accessed via refs so the closure never goes stale.
  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) { rafRef.current = null; return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    partsRef.current = stepParticles(partsRef.current);
    for (const p of partsRef.current) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x * dpr, p.y * dpr, p.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (partsRef.current.length > 0) {
      rafRef.current = window.requestAnimationFrame(loop);
    } else {
      rafRef.current = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // Fix 1 + 2: each setTimeout pushes particles then starts the loop if idle.
  // The loop is NOT called after the for-loop (partsRef is empty at that point).
  // Fix 2: empty deps array stabilises the handle — all closed-over values are
  // refs or the stable `loop` callback.
  useImperativeHandle(ref, () => ({
    launch() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      const W = rect.width, H = rect.height;
      const shells = 3 + ((Math.random() * 3) | 0);
      for (let sIdx = 0; sIdx < shells; sIdx++) {
        const id = window.setTimeout(() => {
          timersRef.current.delete(id);
          partsRef.current.push(
            ...spawnBurst(W * (0.18 + Math.random() * 0.64), H * (0.18 + Math.random() * 0.42), Math.random),
          );
          // Start the loop only after particles have been pushed; if the loop is
          // already running (from a prior shell in this burst) it will pick them up
          // naturally on its next frame.
          if (rafRef.current === null) loop();
        }, sIdx * 170);
        timersRef.current.add(id);
      }
      // No loop() call here: partsRef.current is still empty at this point, so
      // calling loop() would immediately take the no-particles branch, null rafRef,
      // and return — leaving the deferred shells with no renderer.
    },
  }), [loop]);

  // Fix 3: cancel both the rAF and any pending shell timers on unmount.
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  }, []);

  return <canvas ref={canvasRef} className={s.canvas} aria-hidden />;
});
