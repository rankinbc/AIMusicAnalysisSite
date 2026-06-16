import * as Switch from '@radix-ui/react-switch';
import * as Slider from '@radix-ui/react-slider';
import { LASER_MAX } from './laser';
import type { VizState } from './StageDisplay';
import type { LaserEffect } from './LaserRig';
import s from './VizControls.module.css';

interface Props {
  viz: VizState;
  onChange: (patch: Partial<VizState>) => void;
  onLaunchFireworks: () => void;
}

const BAR_COLORS = ['#00e5b0', '#60a5fa', '#a78bfa', '#fb923c', '#f472b6'];
const BG_COLORS = ['#0c0f15', '#06080c', '#0c1420', '#101a26'];
const LASER_COLORS: Array<{ id: string; label: string; color: string }> = [
  { id: 'multi', label: 'Multi', color: '' },
  { id: 'pink', label: 'Pink', color: '#f472b6' },
  { id: 'mint', label: 'Mint', color: '#5eead4' },
  { id: 'blue', label: 'Blue', color: '#60a5fa' },
  { id: 'lime', label: 'Lime', color: '#a3e635' },
  { id: 'white', label: 'White', color: '#ffffff' },
];
const EFFECTS: LaserEffect[] = ['sweep', 'strobe', 'flash', 'beat'];

/** Single source of truth for the viz defaults. The route seeds its
 *  `useState<VizState>` from this so the bar/bg swatch arrays aren't
 *  duplicated. `laserColor` keeps the prototype pink literal — the active-
 *  swatch highlight in this component only checks it when `laserMono` is on. */
// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_VIZ_STATE: VizState = {
  enabled: false,
  barColor: BAR_COLORS[0]!,
  bgColor: BG_COLORS[0]!,
  laserOn: false,
  laserMono: false,
  laserColor: '#f472b6',
  laserEffect: 'sweep',
  laserIntensity: 70,
};

export function VizControls({ viz, onChange, onLaunchFireworks }: Props) {
  return (
    <div className={s.block}>
      <div className={s.row}>
        <span className={s.heading}>Visualizations</span>
        <Switch.Root
          className={s.switch}
          checked={viz.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
        >
          <Switch.Thumb className={s.thumb} />
        </Switch.Root>
      </div>

      <fieldset className={s.sub} disabled={!viz.enabled}>
        <span className={`${s.subLabel} label`}>EQ bar color</span>
        <div className={s.swatches}>
          {BAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={s.swatch}
              data-active={viz.barColor === c}
              style={{ background: c }}
              onClick={() => onChange({ barColor: c })}
              aria-label={`Bar ${c}`}
            />
          ))}
        </div>

        <span className={`${s.subLabel} label`}>Backdrop</span>
        <div className={s.swatches}>
          {BG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={s.swatch}
              data-active={viz.bgColor === c}
              style={{ background: c }}
              onClick={() => onChange({ bgColor: c })}
              aria-label={`Backdrop ${c}`}
            />
          ))}
        </div>

        <div className={s.row}>
          <span className={`${s.subLabel} label`}>Laser light</span>
          <Switch.Root
            className={s.switch}
            checked={viz.laserOn}
            onCheckedChange={(laserOn) => onChange({ laserOn })}
          >
            <Switch.Thumb className={s.thumb} />
          </Switch.Root>
        </div>

        <fieldset className={s.laserSub} disabled={!viz.laserOn}>
          <span className={`${s.subLabel} label`}>Intensity {viz.laserIntensity}%</span>
          <Slider.Root
            className={s.slider}
            min={0}
            max={LASER_MAX}
            value={[viz.laserIntensity]}
            onValueChange={([v]) => onChange({ laserIntensity: v ?? 0 })}
          >
            <Slider.Track className={s.track}>
              <Slider.Range className={s.range} />
            </Slider.Track>
            <Slider.Thumb className={s.sliderThumb} aria-label="Laser intensity" />
          </Slider.Root>

          <span className={`${s.subLabel} label`}>Color</span>
          <div className={s.swatches}>
            {LASER_COLORS.map((lc) => (
              <button
                key={lc.id}
                type="button"
                className={s.swatch}
                data-active={
                  lc.id === 'multi'
                    ? !viz.laserMono
                    : viz.laserMono && viz.laserColor === lc.color
                }
                style={{
                  background:
                    lc.color ||
                    'conic-gradient(from 0deg, #f472b6, #5eead4, #fbbf24, #60a5fa, #a78bfa, #f472b6)',
                }}
                onClick={() =>
                  onChange(
                    lc.id === 'multi'
                      ? { laserMono: false }
                      : { laserMono: true, laserColor: lc.color },
                  )
                }
                aria-label={lc.label}
              />
            ))}
          </div>

          <span className={`${s.subLabel} label`}>Effect</span>
          <div className={s.effects}>
            {EFFECTS.map((fx) => (
              <button
                key={fx}
                type="button"
                className={s.fxBtn}
                data-active={viz.laserEffect === fx}
                onClick={() => onChange({ laserEffect: fx })}
              >
                {fx}
              </button>
            ))}
          </div>
        </fieldset>

        <button type="button" className="btn sm" onClick={onLaunchFireworks}>
          Launch fireworks
        </button>
      </fieldset>
    </div>
  );
}
