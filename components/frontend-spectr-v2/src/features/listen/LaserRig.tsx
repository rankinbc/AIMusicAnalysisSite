import s from './LaserRig.module.css';

export type LaserEffect = 'sweep' | 'strobe' | 'flash' | 'beat';

interface Props {
  on: boolean;
  mono: boolean;
  effect: LaserEffect;
}

// Per-beam color + delay come from the prototype's 5-beam rainbow set. In mono
// mode the CSS var --laser-c overrides each beam's --bc.
const BEAMS = [
  { bc: '#f472b6', dl: '0s', left: '12%' },
  { bc: '#5eead4', dl: '0.1s', left: '31%' },
  { bc: '#fbbf24', dl: '0.2s', left: '50%' },
  { bc: '#60a5fa', dl: '0.3s', left: '69%' },
  { bc: '#a78bfa', dl: '0.4s', left: '88%' },
];

/**
 * Renders a 5-beam laser-rig overlay.
 *
 * **Mono-mode CSS contract**: when `mono` is `true`, each beam's colour is
 * overridden via the CSS custom property `--laser-c` (see `.mono .beam` in
 * `LaserRig.module.css`). `LaserRig` itself does **not** set `--laser-c`;
 * the consumer is responsible for injecting it on an ancestor element.
 * `StageDisplay` does this via an inline `style` on the stage wrapper.
 * If `--laser-c` is absent the beams fall back to the default pink (#f472b6).
 */
export function LaserRig({ on, mono, effect }: Props) {
  const cls = [s.lasers, on ? s.on : '', mono ? s.mono : '', s[`fx_${effect}`] ?? ''].join(' ');
  return (
    <div className={cls} aria-hidden>
      {BEAMS.map((b, i) => (
        <span
          key={i}
          className={s.beam}
          style={{ ['--bc' as string]: b.bc, ['--dl' as string]: b.dl, left: b.left }}
        />
      ))}
      <span className={s.flash} />
    </div>
  );
}
