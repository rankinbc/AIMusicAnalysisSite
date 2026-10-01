// The analysis page's listening backdrop: while the mix plays, the Listen
// page's calm visuals fill the page BEHIND the analysis box — the floor grid
// (shared drawFloorGrid) under the smoke + bloom stage layers (the Listen
// visualizer's own StageCanvas), all breathing with the playing audio's
// analyser. Reused, not copied: the only thing computed here is the frame
// (energy + an onset pulse) the shared renderers draw from.
//
// Mounted only while playing (plus the fade-out); fades in on play and out on
// pause. Rendering stops when the audio pauses or the tab is hidden; under
// reduced motion one still frame is painted (no loop, no pulse). No full-field
// flash is ever produced here — VizStage's drop/flash director isn't used.

import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '../../hooks/useReducedMotion';
import { drawFloorGrid } from '../listen-rack/floorGrid';
import { cssVar } from '../listen-rack/helpers';
import { StageCanvas, type StageCanvasHandle, type VizFrame } from '../listen-rack/viz-canvases';
import s from './AnalysisCompleteModal.module.css';

/** Matches the .listenBg opacity transition. */
export const BACKDROP_FADE_MS = 700;
const STAGES = ['smoke', 'bloom'];

interface Props {
  playing: boolean;
  getAnalyser: () => AnalyserNode | null;
}

export function LiveListenBackdrop({ playing, getAnalyser }: Props) {
  const [mounted, setMounted] = useState(playing);
  useEffect(() => {
    if (playing) {
      setMounted(true);
      return undefined;
    }
    const t = setTimeout(() => setMounted(false), BACKDROP_FADE_MS);
    return () => clearTimeout(t);
  }, [playing]);
  if (!mounted) return null;
  return (
    <div className={s.listenBg} data-on={playing} data-testid="acm-listen-bg" aria-hidden>
      <Layers live={playing} getAnalyser={getAnalyser} />
    </div>
  );
}

function Layers({ live, getAnalyser }: { live: boolean; getAnalyser: () => AnalyserNode | null }) {
  const stageRef = useRef<StageCanvasHandle>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    // Paused (fading out): keep the last frame, stop drawing.
    if (!live) return undefined;
    const accent = cssVar('var(--cyan)');
    const frame: VizFrame = { t: 0, spectrum: [], energy: 0.3, pulse: 0, beat: false, flash: 0 };
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let avg = 0.3;
    let raf = 0;
    const t0 = performance.now();

    const paint = (now: number) => {
      const an = getAnalyser();
      let e = 0.3;
      if (an) {
        if (!bins || bins.length !== an.frequencyBinCount) bins = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(bins);
        // Lower half of the spectrum — where the energy of a mix lives.
        const n = Math.max(1, Math.floor(bins.length / 2));
        let sum = 0;
        for (let i = 0; i < n; i++) sum += bins[i]!;
        e = sum / (n * 255);
      }
      frame.t = now;
      frame.energy = Math.max(0.08, Math.min(1, e * 1.6));
      // Onset → a soft pulse on the bloom core (decays like VizStage's).
      if (!reduce && frame.energy > avg * 1.22 + 0.03) frame.pulse = 1;
      avg = avg * 0.94 + frame.energy * 0.06;
      frame.pulse *= 0.86;
      stageRef.current?.draw(frame, STAGES, accent);
      const c = gridRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = c.clientWidth;
        const H = c.clientHeight;
        if (c.width !== W * dpr || c.height !== H * dpr) {
          c.width = W * dpr;
          c.height = H * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawFloorGrid(ctx, W, H, (now - t0) / 1000, {
          hue: 168,
          gridIntensity: 80 + frame.energy * 90,
          intensity: 1,
          live: 1,
        });
      }
    };

    if (reduce) {
      const still = () => paint(performance.now());
      still();
      window.addEventListener('resize', still);
      return () => window.removeEventListener('resize', still);
    }

    const loop = (now: number) => {
      paint(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [live, reduce, getAnalyser]);

  return (
    <>
      <canvas ref={gridRef} className={s.listenGrid} />
      <StageCanvas ref={stageRef} accent="var(--cyan)" />
    </>
  );
}
