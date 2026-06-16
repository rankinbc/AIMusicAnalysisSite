import { memo, type ReactNode } from 'react';
import { StageSelect } from './StageSelect';
import { EqCurveOverlay } from './EqCurveOverlay';
import { LaserRig, type LaserEffect } from './LaserRig';
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
}

interface Props {
  stage: StageId;
  onStageChange: (id: StageId) => void;
  spectrumValues: number[]; // the eq stage bars (0..1)
  beatSeconds: number; // --beat from BPM
  viz: VizState;
  meterOverlay: ReactNode; // <MeterModule variant="overlay" />
  fireworks: ReactNode; // <Fireworks ref=... />
  infoContent: ReactNode; // title/cover/pills for the info stage
}

export function StageDisplay(props: Props) {
  const { stage, viz } = props;

  const styleVars: Record<string, string | number> = {
    '--beat': `${props.beatSeconds}s`,
    ...(viz.enabled ? { '--viz-bar': viz.barColor, '--viz-bg': viz.bgColor } : {}),
    ...(viz.laserOn ? laserVars(viz.laserIntensity) : {}),
    ...(viz.laserMono ? { '--laser-c': viz.laserColor } : {}),
  };

  return (
    <div
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
              <span key={i} className={s.bar} style={{ height: `${Math.round(v * 92)}%` }} />
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

      {/* decorative stages — markup hooks; CSS in the stylesheet drives them */}
      {stage === 'lights' && <LightsStage />}
      {stage === 'bloom' && <BloomStage />}
      {stage === 'orbit' && <OrbitStage />}
      {stage === 'info' && <div className={s.info}>{props.infoContent}</div>}

      <LaserRig on={viz.laserOn} mono={viz.laserMono} effect={viz.laserEffect} />
      {props.fireworks}
    </div>
  );
}
