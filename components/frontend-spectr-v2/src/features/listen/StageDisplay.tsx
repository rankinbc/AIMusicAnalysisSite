import { memo, type ReactNode, type RefObject } from 'react';
import { StageSelect } from './StageSelect';
import { EqCurveOverlay } from './EqCurveOverlay';
import { type LaserEffect } from './LaserRig';
import type { StageId } from './stageRegistry';
import { laserVars } from './laser';
import s from './StageDisplay.module.css';

// Club-light palette for the lights stage. Multicolor is the whole point of
// this decorative stage, so it intentionally steps outside the one-accent rule.
const LIGHT_COLORS = ['#00e5b0', '#a78bfa', '#60a5fa', '#fbbf24', '#34d399', '#f472b6'];

const LightsStage = memo(function LightsStage() {
  return (
    <div className={s.lights} aria-hidden="true">
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          style={{
            ['--lc' as string]: LIGHT_COLORS[i % LIGHT_COLORS.length],
            // Deterministic delay spread so cells fire out of phase.
            ['--ld' as string]: `${((((i * 5) % 18) / 18) * 0.48).toFixed(3)}s`,
          }}
        />
      ))}
    </div>
  );
});

const BloomStage = memo(function BloomStage() {
  return (
    <div className={s.bloom}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.48}s` }} />
      ))}
    </div>
  );
});

const OrbitStage = memo(function OrbitStage() {
  return (
    <div className={s.orbit}>
      <span className={s.core} />
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} className={s.dot} />
      ))}
    </div>
  );
});

const DB_LABELS = ['0', '-6', '-12', '-24', '-36', '-60'];
const FREQ_LABELS = ['20', '60', '200', '500', '1k', '2k', '5k', '10k', '20k'];

export interface VizState {
  enabled: boolean;
  barColor: string;
  bgColor: string;
  laserOn: boolean;
  laserMono: boolean;
  laserColor: string; // used when mono
  laserEffect: LaserEffect;
  laserIntensity: number; // 0..400, the source of truth
  energy: number; // 0..100 macro; 50 = neutral (×1). Scales laser + bars + radial.
  autoColor: boolean; // drive bar/backdrop hue from the spectral centroid
  dropFx: boolean; // fire fireworks + max laser on detected drops
}

interface Props {
  stage: StageId;
  onStageChange: (id: StageId) => void;
  spectrumValues: number[]; // the eq stage bars (0..1)
  beatSeconds: number; // --beat from BPM
  viz: VizState;
  meterOverlay: ReactNode; // <MeterModule variant="overlay" />
  fireworks: ReactNode; // <Fireworks ref=... />
  radial: ReactNode; // <RadialPulse ref=... />, shown on the 'radial' stage
  spectro: ReactNode; // <Spectrogram ref=... />, shown on the 'spectro' stage
  laser: ReactNode; // <LaserShow ref=... /> overlay, drawn by the page loop
  infoContent: ReactNode; // title/cover/pills for the info stage
  // Optional ref to the visualizer root so the page's rAF loop can write
  // audio-reactive CSS vars (--laser-pulse / --beat-flash) imperatively
  // without a per-frame React re-render.
  rootRef?: RefObject<HTMLDivElement | null>;
}

export function StageDisplay(props: Props) {
  const { stage, viz } = props;

  // Energy macro: 50 = neutral (×1), 0 = ×0, 100 = ×2. Scales the laser
  // intensity, the EQ bar gain, and (via the page loop) the radial reach.
  const energyMul = Math.max(0, Math.min(2, (viz.energy ?? 50) / 50));

  // When auto-color is on the page loop writes --viz-bar / --viz-bg
  // imperatively from the spectral centroid, so we must NOT set them here (a
  // React inline style would overwrite the loop's value every render).
  const styleVars: Record<string, string | number> = {
    '--beat': `${props.beatSeconds}s`,
    ...(viz.enabled && !viz.autoColor ? { '--viz-bar': viz.barColor, '--viz-bg': viz.bgColor } : {}),
    ...(viz.laserOn ? laserVars(viz.laserIntensity * energyMul) : {}),
    ...(viz.laserMono ? { '--laser-c': viz.laserColor } : {}),
  };

  return (
    <div
      ref={props.rootRef}
      className={`${s.visualizer} ${viz.enabled ? s.vizCustom : ''}`}
      data-stage={stage}
      style={styleVars as React.CSSProperties}
    >
      <div className={s.overlayTL}>
        <StageSelect value={stage} onChange={props.onStageChange} />
        {stage === 'eq' && <span className={s.modeChip}>EQ · 8-BAND OVERLAY</span>}
      </div>

      {stage !== 'info' && <div className={s.overlayTR}>{props.meterOverlay}</div>}

      {/* eq stage */}
      {stage === 'eq' && (
        <>
          <div className={s.dbGutter} aria-hidden="true">
            {DB_LABELS.map((d) => (
              <span key={d} className="mono">{d}</span>
            ))}
          </div>
          <div className={s.spectrum} aria-hidden="true">
            {props.spectrumValues.map((v, i) => (
              <span
                key={i}
                className={s.bar}
                style={{ height: `${Math.min(100, Math.round(v * 92 * energyMul))}%` }}
              />
            ))}
          </div>
          <div className={s.freqGrid} aria-hidden="true">
            {FREQ_LABELS.map((f) => (
              <span key={f} className="mono">{f}</span>
            ))}
          </div>
          <EqCurveOverlay />
        </>
      )}

      {/* radial pulse — Canvas 2D, drawn by the page rAF loop via RadialPulse ref */}
      {stage === 'radial' && props.radial}

      {/* spectrogram — Canvas 2D waterfall, drawn by the page rAF loop */}
      {stage === 'spectro' && props.spectro}

      {/* decorative stages — markup hooks; CSS in the stylesheet drives them */}
      {stage === 'lights' && <LightsStage />}
      {stage === 'bloom' && <BloomStage />}
      {stage === 'orbit' && <OrbitStage />}
      {stage === 'info' && <div className={s.info}>{props.infoContent}</div>}

      {props.laser}
      {props.fireworks}
    </div>
  );
}
