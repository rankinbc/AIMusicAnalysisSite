// STEREO panel — three CSS-only meters for phase1 stereo metrics:
//   1. Width            (0..1) — left-anchored cyan fill
//   2. Correlation     (-1..1) — center-anchored; positive grows right (cyan),
//                                negative grows left (red = phase trouble)
//   3. Mono Compat      (0..1) — left-anchored, color shifts red→orange→cyan
//
// Every row is tolerant of undefined: the meter shows an empty track and the
// numeric readout becomes an em-dash via the formatter helpers.

import { fmtNumber, fmtPercent } from './helpers/format';
import s from './StereoCard.module.css';

interface StereoCardProps {
  width: number | undefined; // phase1.stereo_width — 0..1
  correlation: number | undefined; // phase1.stereo_correlation — -1..1
  monoCompat: number | undefined; // phase1.mono_compatibility — 0..1
}

// Above |x| > 0.95 the meter gets a subtle glow to flag near-extreme values.
const CORRELATION_GLOW_THRESHOLD = 0.95;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function monoCompatColor(v: number | undefined): string {
  if (v === undefined) return 'var(--muted)';
  if (v >= 0.85) return 'var(--cyan)';
  if (v >= 0.7) return 'var(--orange)';
  return 'var(--red)';
}

export function StereoCard({ width, correlation, monoCompat }: StereoCardProps) {
  // ── Width row ─────────────────────────────────────────────────────────────
  const widthPct = width === undefined ? 0 : clamp(width, 0, 1) * 100;

  // ── Correlation row ───────────────────────────────────────────────────────
  // Bar is anchored at the 50% center mark. For positive values it extends
  // right; for negative it extends left. Magnitude is |corr| * 50%.
  const corrClamped = correlation === undefined ? 0 : clamp(correlation, -1, 1);
  const corrMagnitudePct = Math.abs(corrClamped) * 50;
  const corrIsPositive = corrClamped >= 0;
  const corrGlow =
    correlation !== undefined && Math.abs(correlation) > CORRELATION_GLOW_THRESHOLD;
  const corrFillStyle = corrIsPositive
    ? { left: '50%', width: `${corrMagnitudePct}%` }
    : { right: '50%', width: `${corrMagnitudePct}%` };

  // ── Mono Compat row ───────────────────────────────────────────────────────
  const monoPct = monoCompat === undefined ? 0 : clamp(monoCompat, 0, 1) * 100;
  const monoColor = monoCompatColor(monoCompat);

  return (
    <section className={s.panel}>
      <h3 className={s.title}>Stereo</h3>

      <div className={s.rows}>
        {/* Width */}
        <div className={s.row}>
          <div className={s.rowHead}>
            <span className={s.label}>Width</span>
            <span className={`${s.value} mono`}>{fmtPercent(width)}</span>
          </div>
          <div className={s.track}>
            <div
              className={s.fillLeft}
              style={{ width: `${widthPct}%`, background: 'var(--cyan)' }}
            />
          </div>
        </div>

        {/* Correlation */}
        <div className={s.row}>
          <div className={s.rowHead}>
            <span className={s.label}>Correlation</span>
            <span className={`${s.value} mono`}>{fmtNumber(correlation, 2)}</span>
          </div>
          <div className={`${s.track} ${s.trackCentered}`}>
            <div className={s.centerMark} aria-hidden="true" />
            {correlation !== undefined && (
              <div
                className={`${s.fillCentered} ${corrGlow ? s.fillGlow : ''}`}
                style={{
                  ...corrFillStyle,
                  background: corrIsPositive ? 'var(--cyan)' : 'var(--red)',
                }}
              />
            )}
          </div>
        </div>

        {/* Mono Compat */}
        <div className={s.row}>
          <div className={s.rowHead}>
            <span className={s.label}>Mono Compat</span>
            <span className={`${s.value} mono`}>{fmtPercent(monoCompat)}</span>
          </div>
          <div className={s.track}>
            <div
              className={s.fillLeft}
              style={{ width: `${monoPct}%`, background: monoColor }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
