import s from './LaserRig.module.css';

export type LaserEffect = 'sweep' | 'strobe' | 'flash' | 'beat';

interface Props {
  on: boolean;
  mono: boolean;
  effect: LaserEffect;
}

// Per-beam color + delay form a denser rainbow fan. In mono mode the CSS var
// --laser-c overrides each beam's --bc. Staggered delays make the sweep/beat
// motion fan out across the beams instead of moving as one block.
const BEAM_COLORS = ['#f472b6', '#5eead4', '#fbbf24', '#60a5fa', '#a78bfa', '#34d399'];
const BEAM_COUNT = 11;
const BEAMS = Array.from({ length: BEAM_COUNT }, (_, i) => ({
  bc: BEAM_COLORS[i % BEAM_COLORS.length]!,
  dl: `${(i * 0.06).toFixed(2)}s`,
  // Spread evenly across 5%..95% so the fan fills the stage width.
  left: `${(5 + (90 * i) / (BEAM_COUNT - 1)).toFixed(1)}%`,
}));

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
