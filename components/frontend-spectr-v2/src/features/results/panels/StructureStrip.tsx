import type { Phase1Structure } from '../../../api/types';
import { segmentBands } from '../track-info-helpers';
import s from '../track-info-panels.module.css';

const SEG_HUES = [172, 280, 32, 210, 320, 140, 250];

/** Proportional song-structure strip (intro/build/drop…) from allin1 segments.
 *  Renders nothing when structure is unavailable/deferred — degrades cleanly. */
export function StructureStrip({
  structure,
  durationSec,
}: {
  structure: Phase1Structure | undefined;
  durationSec: number | undefined;
}) {
  const bands = segmentBands(structure?.segments, durationSec);
  if (bands.length === 0) return null;
  return (
    <div className={s.strip} aria-label="Song structure">
      {bands.map((b, i) => (
        <span
          key={i}
          className={s.seg}
          style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%`, ['--h' as string]: String(SEG_HUES[i % SEG_HUES.length]) }}
          title={b.label}
        >
          <span className={s.segLabel}>{b.label}</span>
        </span>
      ))}
    </div>
  );
}
