import type { Phase1Structure } from '../../../api/types';
import { tiTime } from '../track-info-helpers';

/** Proportional song-structure strip (intro/build/drop…) from allin1 segments.
 *  Reproduces the prototype's `.struct-strip`/`.ss-seg` flex markup (phase1.structure.segments).
 *  Renders nothing when structure is unavailable/deferred — degrades cleanly. */
export function StructureStrip({
  structure,
  durationSec,
  compact,
}: {
  structure: Phase1Structure | undefined;
  durationSec: number | undefined;
  compact?: boolean;
}) {
  const segments = structure?.segments;
  if (!segments || segments.length === 0 || !durationSec || durationSec <= 0) return null;
  return (
    <div className={`struct-strip${compact ? ' compact' : ''}`} title="phase1.structure.segments">
      {segments.map((sg, i) => (
        <div
          className="ss-seg"
          key={i}
          style={{ width: `${((sg.end - sg.start) / durationSec) * 100}%` }}
          title={`${sg.label} · ${tiTime(sg.start)}–${tiTime(sg.end)}`}
        >
          <span>{sg.label}</span>
        </div>
      ))}
    </div>
  );
}
