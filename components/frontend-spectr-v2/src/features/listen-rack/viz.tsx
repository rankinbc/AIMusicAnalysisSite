/* SPECTR · Listen rack redesign — Visualizer stage (ported to TS)
 * Spectrum + EQ overlay, laser fan, fireworks, radial/orbit/bloom/lights/spectro/
 * info stages, plus the AUTO director that auto-pilots the stage. One rAF in
 * VizStage computes a `frame`, then calls child .draw(frame) handles. The three
 * canvas layers it drives (StageCanvas / LaserFan / Fireworks) live in
 * viz-canvases.tsx.
 *
 * SWAP BOUNDARY: the spectrum/levels are SYNTHETIC here. Replace the procedural
 * `frameRef.current.spectrum`/energy with a real AnalyserNode tap (see
 * PORTING_NOTES.md → StageCanvas).
 */
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { CoverArt } from '../../ui/CoverArt';
import type { AudioFrame } from '../listen/useAudioGraph';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { type Director, type EqBand, type ModuleManifest, type VizState } from './data';
import { StagePlacementButton } from './findings/StagePlacementButton';
import { cssVar, freqToX, hslToHex, safeFlashHz } from './helpers';
import { ModuleIcon } from './ui';
import {
  Fireworks, LaserFan, StageCanvas,
  type FireworksHandle, type FlashPoint, type LaserFanHandle, type StageCanvasHandle, type VizFrame,
} from './viz-canvases';

// ── EQ response curve overlay (exported; kept for parity, not mounted) ──────
export function EqCurveOverlay({ bands }: { bands: EqBand[]; accent?: string }) {
  const W = 1000, H = 200, midY = H * 0.46;
  const dbToY = (db: number) => midY - db * (H * 0.026);
  const gainAt = (xp: number) => bands.reduce((g, b) => {
    const bx = freqToX(b.freq), sigma = 0.085 / (b.q || 1) + 0.03;
    return g + b.gainDb * Math.exp(-Math.pow((xp - bx) / sigma, 2));
  }, 0);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 160; i++) { const xp = i / 160; pts.push([xp * W, dbToY(gainAt(xp))]); }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="lreqstroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#00e5b0" /></linearGradient>
        <linearGradient id="lreqfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(167,139,250,0.18)" /><stop offset="1" stopColor="rgba(0,229,176,0.01)" /></linearGradient>
      </defs>
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
      <path d={`${line} L ${W} ${midY} L 0 ${midY} Z`} fill="url(#lreqfill)" />
      <path d={line} fill="none" stroke="url(#lreqstroke)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {bands.map((b, i) => {
        const x = freqToX(b.freq) * W, y = dbToY(b.gainDb), on = Math.abs(b.gainDb) > 0.05;
        return <g key={i}><circle cx={x} cy={y} r={on ? 9 : 6} fill={on ? 'rgba(0,229,176,0.16)' : 'rgba(255,255,255,0.05)'} stroke={on ? '#00e5b0' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><circle cx={x} cy={y} r="2" fill={on ? '#00e5b0' : 'rgba(255,255,255,0.5)'} /></g>;
      })}
    </svg>
  );
}

// EQ axis measurements (frequency + dB) overlaid on the spectrum
function EqAxes() {
  const F: [number, string][] = [[60, '60'], [120, '120'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
  const DB = [0, -12, -24, -36];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {DB.map((d, i) => (
        <div key={d} style={{ position: 'absolute', left: 0, right: 8, top: `${10 + i * 24}%` }}>
          <div style={{ position: 'absolute', left: 30, right: 0, height: 1, background: 'rgba(255,255,255,0.05)' }} />
          <span className="mono" style={{ position: 'absolute', left: 6, top: -6, fontSize: 8.5, color: 'rgba(255,255,255,0.32)' }}>{d}</span>
        </div>
      ))}
      {F.map(([hz, l]) => (
        <span key={hz} className="mono" style={{ position: 'absolute', bottom: 4, left: `${freqToX(hz) * 100}%`, transform: 'translateX(-50%)', fontSize: 8.5, color: 'rgba(255,255,255,0.32)' }}>{l}</span>
      ))}
    </div>
  );
}

// Rack stage — side-scrolling marquee of the active chain devices
function RackStage({ modules }: { modules: ModuleManifest[] }) {
  if (!modules || modules.length === 0) {
    return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2 }}><span className="mono" style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.1em' }}>RACK IS FLAT — enable a device to see the chain</span></div>;
  }
  const row = [...modules, ...modules];
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', zIndex: 2 }}>
      <div className="lr-rack-marquee" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {row.map((m, i) => (
          <Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>→</span>}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 22px', borderRadius: 14, minWidth: 120, background: `linear-gradient(180deg, ${cssVar(m.accent)}1f, ${cssVar(m.accent)}06)`, border: `1px solid ${cssVar(m.accent)}55`, boxShadow: `0 0 26px ${cssVar(m.accent)}33` }}>
              <ModuleIcon glyph={m.glyph} accent={m.accent} on size={44} />
              <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</div>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: m.accent }}>● ACTIVE</span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ── The stage ──────────────────────────────────────────────────────────────
export function VizStage({
  playing, stages, setStages, viz, director, height = 300, compact = false, onStageEngine, activeModules, getFrame, trackName = 'Aurora', trackSub = 'v3 · Final Mix', bgMode, onBgModeChange, slot = 'ghost',
}: {
  playing: boolean;
  stages: string[];
  setStages: (v: string[]) => void;
  viz: VizState;
  director: Director | undefined;
  height?: number;
  compact?: boolean;
  onStageEngine?: React.Ref<HTMLDivElement>;
  activeModules: ModuleManifest[];
  /** Real AnalyserNode frame source (Phase 2 Task 3). When supplied, the spectrum
   *  bars + energy come from the live mix; absent ⇒ synthetic (mock demo route). */
  getFrame?: () => AudioFrame | null;
  /** Track Info stage copy (v2 page passes the real track; fixture defaults). */
  trackName?: string;
  trackSub?: string;
  /** Story "findings in the stage": background mode is owned by the page now,
   *  so the placement pref can persist and the stage card can put the board in
   *  the box while the visualizer keeps playing behind the page. */
  bgMode: boolean;
  onBgModeChange: (v: boolean) => void;
  /** What occupies the CARD SLOT while bgMode is on. 'ghost' is the frosted
   *  "visualizer is playing in the background" placeholder (the visualizer
   *  view); 'none' means someone else owns the box, so only the portal
   *  renders. */
  slot?: 'ghost' | 'none';
}) {
  const stageRef = useRef<StageCanvasHandle>(null);
  const laserRef = useRef<LaserFanHandle>(null);
  const fireRef = useRef<FireworksHandle>(null);
  const bgLayerRef = useRef<HTMLDivElement>(null);
  // Background mode: the visualizer pops out to a fixed full-viewport layer
  // BEHIND the page (portaled to <body>, z-index 0; page content z-index 1, top
  // nav 50), so the page stays in place while the viz fills the window. Esc
  // exits — but ONLY when this stage owns the card slot: in the findings view
  // the board owns it, and Esc must not silently kill the background visuals.
  useEffect(() => {
    if (!bgMode || slot === 'none') return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBgModeChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bgMode, slot, onBgModeChange]);
  const frameRef = useRef<VizFrame>({ t: 0, spectrum: new Array(56).fill(0), energy: 0.4, pulse: 0, beat: false, flash: 0 });
  const beatPhase = useRef(0), lastDrop = useRef(0), autoLast = useRef(0);
  const flashPtsRef = useRef<FlashPoint[]>([]), lastBurst = useRef(0), autoReactLast = useRef(0);
  const accentHex = useMemo(() => cssVar(viz.barColor || 'var(--cyan)'), [viz.barColor]);
  const stageRef2 = useRef(stages); stageRef2.current = stages;
  const getFrameRef = useRef(getFrame); getFrameRef.current = getFrame;
  // Photosensitivity: freeze full-field flashes under prefers-reduced-motion.
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion); reduceMotionRef.current = reduceMotion;

  // single rAF: compute frame → drive canvas + laser; auto-director cycles stage
  useEffect(() => {
    if (!playing) { laserRef.current?.clear(); return undefined; }
    let raf = 0;
    let prev = performance.now();
    const bpm = 128, beatSec = 60 / bpm;
    const loop = (now: number) => {
      const dt = (now - prev) / 1000; prev = now;
      const f = frameRef.current; f.t = now;
      const autoDir = director ? director.id !== 'off' : false;
      beatPhase.current += dt / beatSec; let beat = false;
      if (beatPhase.current >= 1) { beatPhase.current -= 1; beat = true; }
      f.beat = beat;
      const dirE = (director && director.id !== 'off' && director.energy != null) ? director.energy / 100 : ((viz && viz.energy != null) ? viz.energy / 100 : 0.5);
      const lfo = 0.5 + 0.5 * Math.sin(now / 2600);
      f.energy = Math.max(0.08, Math.min(1, dirE * 0.7 + lfo * 0.4));
      // Real audio (Phase 2 Task 3): override the synthetic spectrum + energy from
      // the live AnalyserNode frame so the bars/laser/bg breathe with the actual
      // mix. Beat/drop/flash stay synthetic — no new audio-driven full-field flash.
      const realFrame = getFrameRef.current?.();
      const hasReal = !!realFrame && realFrame.fftBins.length > 0;
      if (hasReal && realFrame && realFrame.bandAverages.length > 0) {
        const ba = realFrame.bandAverages;
        let s = 0; for (let k = 0; k < ba.length; k++) s += ba[k];
        f.energy = Math.max(0.08, Math.min(1, (s / ba.length) * 1.5));
      }
      if (bgLayerRef.current) bgLayerRef.current.style.opacity = viz.bgSync ? (0.4 + f.energy * 0.9).toFixed(2) : '';
      const dropFx = !director || director.id === 'off' ? viz.dropFx : true;
      if (dropFx && now - lastDrop.current > (director && director.id === 'hype' ? 6000 : 9000) && lfo > 0.82) {
        lastDrop.current = now;
        // Reduced-motion: skip the fireworks burst + full-field flash; keep the
        // (subtle) pulse and the presence callback.
        if (!reduceMotionRef.current) { fireRef.current?.launch(); f.flash = 1; }
        f.pulse = 1;
      }
      if (beat) f.pulse = 1; f.pulse *= 0.86; f.flash *= 0.8;
      const n = f.spectrum.length;
      if (hasReal && realFrame) {
        // Log-spaced down-sample of the real FFT to the bar count (mirrors the
        // shipping /listen/$versionId draw loop) so bass doesn't dominate.
        const bins = realFrame.fftBins;
        const minLog = Math.log10(1), maxLog = Math.log10(bins.length);
        for (let i = 0; i < n; i++) {
          const lo = Math.floor(10 ** (minLog + (i / n) * (maxLog - minLog)));
          const hi = Math.max(lo + 1, Math.floor(10 ** (minLog + ((i + 1) / n) * (maxLog - minLog))));
          let sum = 0; for (let j = lo; j < hi && j < bins.length; j++) sum += bins[j];
          f.spectrum[i] = Math.max(0.02, Math.min(1, (sum / Math.max(1, hi - lo)) * 1.4 * (1 + f.pulse * 0.2)));
        }
      } else {
        for (let i = 0; i < n; i++) {
          const tilt = Math.pow(1 - i / n, 0.7);
          const wob = 0.5 + 0.5 * Math.sin(now / 360 + i * 0.5) * Math.sin(now / 900 + i);
          f.spectrum[i] = Math.max(0.02, Math.min(1, (tilt * 0.7 + 0.15) * (0.5 + wob * 0.7) * f.energy * (1 + f.pulse * 0.35)));
        }
      }
      if (director && director.id !== 'off' && director.stages && director.cycleSec) {
        if (now - autoLast.current > director.cycleSec * 1000) {
          autoLast.current = now;
          const cur = stageRef2.current[0];
          const next = director.stages[(director.stages.indexOf(cur) + 1) % director.stages.length];
          setStages([next]);
        }
      }
      if (!autoDir && viz.autoReact && now - autoReactLast.current > 1000) {
        autoReactLast.current = now;
        const sens = viz.autoReactSens != null ? viz.autoReactSens : 0.55;
        const e2 = Math.min(1, f.energy * (0.6 + sens));
        const want = e2 < 0.34 ? ['bloom'] : e2 < 0.58 ? ['eq'] : e2 < 0.8 ? ['eq', 'radial'] : ['eq', 'radial', 'lights'];
        if (want.join() !== stageRef2.current.join()) setStages(want);
      }
      const acc = viz.autoColor ? hslToHex((((now / 26) % 360) + (viz.specHue || 165)) % 360) : accentHex;
      stageRef.current?.draw(f, stageRef2.current, acc);
      if (viz.laserOn) {
        if (viz.laserFlash && !reduceMotionRef.current && now - lastBurst.current > 2400 + Math.random() * 2800) {
          lastBurst.current = now;
          const k = 3 + Math.floor(Math.random() * 3);
          for (let i = 0; i < k; i++) flashPtsRef.current.push({ x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.66, life: 1, born: now + i * 70 });
        }
        flashPtsRef.current = flashPtsRef.current.filter((p) => { if (now >= p.born) p.life -= 0.07; return p.life > 0; });
        laserRef.current?.draw(f, {
          effect: director && director.id !== 'off' ? (director.laser ?? viz.laserEffect) : viz.laserEffect,
          intensity: Math.min(1.2, ((viz.laserIntensity || 60) / 100) * ((viz.laserSync || (!autoDir && viz.autoReact)) ? (0.4 + f.energy) : 1)),
          mono: viz.laserMono, color: viz.laserColor,
          beams: viz.laserBeams || 13, speed: viz.laserSpeed || 1, move: viz.laserMove, pattern: viz.laserPattern, flashPoints: flashPtsRef.current,
        });
      } else { laserRef.current?.clear(); flashPtsRef.current = []; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, accentHex, viz.laserOn, viz.laserEffect, viz.laserIntensity, viz.laserMono, viz.laserColor, viz.laserBeams, viz.laserSpeed, viz.laserMove, viz.laserFlash, viz.laserPattern, viz.dropFx, viz.autoColor, viz.laserSync, viz.bgSync, viz.autoReact, viz.autoReactSens, director]);

  const isInfo = stages.includes('info');
  const isDevices = stages.includes('devices');

  const stageStyle: React.CSSProperties = bgMode
    ? { position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 0, overflow: 'hidden', background: 'var(--bg-2)' }
    : { position: 'relative', height, overflow: 'hidden', borderRadius: compact ? 0 : 'var(--radius) var(--radius) 0 0', background: 'var(--bg-2)' };

  const stage = (
    <div ref={onStageEngine} style={stageStyle}>
      <div ref={bgLayerRef} className={'viz-bg' + (viz.bgAuto ? ' lr-bg-cycle' : '')} style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 95% 85% at 50% 100%, ${cssVar(viz.bg || 'var(--cyan)')}1f, transparent 62%), transparent` }} />
      {viz.bgFlash && playing && !reduceMotion && <div className="lr-bg-flash" style={{ background: viz.bgFlashColor, animationDuration: (1 / safeFlashHz(viz.bgFlashHz)) + 's' }} />}
      {!isInfo && <StageCanvas ref={stageRef} accent={accentHex} />}
      {isDevices && <RackStage modules={activeModules} />}
      {stages.includes('eq') && <EqAxes />}
      {isInfo && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            {/* Scale the cover to the stage — the v2 card stage is 210px tall. */}
            {height < 300 && !bgMode
              ? <CoverArt hue={168} size="md" style={{ width: 96, height: 96, margin: '0 auto', borderRadius: 12 }} />
              : <CoverArt hue={168} size="lg" style={{ margin: '0 auto' }} />}
            <div style={{ fontSize: height < 300 && !bgMode ? 19 : 26, fontWeight: 800, marginTop: 12 }}>{trackName}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{trackSub}</div>
          </div>
        </div>
      )}
      <LaserFan ref={laserRef} />
      <Fireworks ref={fireRef} />
      {slot !== 'none' && <StagePlacementButton bgMode={bgMode} onChange={onBgModeChange} />}
    </div>
  );

  if (bgMode) {
    // Both `slot` values render the SAME top-level shape here — a Fragment
    // whose second child is always the portal — so a slot flip (the findings
    // board handing the card slot back to the visualizer, or vice versa,
    // while bgMode stays on) never changes the element TYPE at the portal's
    // position. If `slot==='none'` returned the portal directly (no Fragment)
    // while `slot==='ghost'` returned a 2-child Fragment, React would see a
    // Portal-vs-Fragment type mismatch at that position and tear the whole
    // portaled subtree down — losing the spectrogram trail buffer and particle
    // refs and flashing the canvas — on every Findings <-> Visualizer switch.
    return (
      <>
        {slot !== 'none' && (
          // Reserve the card slot so the transport + the rest of the page stay
          // in place while the stage itself plays full-screen behind them.
          <div
            className="lr-vizbg-ghost"
            style={{
              position: 'relative', height, overflow: 'hidden',
              borderRadius: compact ? 0 : 'var(--radius) var(--radius) 0 0',
              // Frosted glass over the full-screen stage behind the page — let the
              // visualizer glow through instead of blanking the slot with bg-2.
              background: 'linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02) 45%, rgba(10,16,28,0.22))',
              backdropFilter: 'blur(9px) saturate(1.35)',
              WebkitBackdropFilter: 'blur(9px) saturate(1.35)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.25)',
              display: 'grid', placeItems: 'center', padding: '0 20px',
            }}
          >
            {/* top sheen */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(255,255,255,0.09), transparent 32%)' }} />
            <div style={{ textAlign: 'center', position: 'relative' }}>
              <div className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.08em', marginBottom: 12, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>⛶ Visualizer is playing full-screen in the background</div>
              <button
                type="button"
                onClick={() => onBgModeChange(false)}
                className="btn sm"
                style={{
                  fontSize: 11, color: '#fff', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.10)',
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 18px rgba(0,0,0,0.35)',
                }}
              >⤡ Bring it back</button>
            </div>
          </div>
        )}
        {createPortal(stage, document.body)}
      </>
    );
  }

  return stage;
}
