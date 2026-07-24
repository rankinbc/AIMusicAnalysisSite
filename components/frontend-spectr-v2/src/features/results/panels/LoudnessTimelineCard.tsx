import type { Phase1Data } from '../../../api/types';
import { pointsToPolyline, segmentBands, timelinePoints } from '../track-info-helpers';
import s from '../track-info-panels.module.css';
import { StructureStrip } from './StructureStrip';

const W = 600;
const H = 120;
const FLOOR = -40;
const CEIL = 0;
const GRID_LUFS = [-30, -20, -14, -6];

const yFor = (lufs: number) => H - ((Math.max(FLOOR, Math.min(CEIL, lufs)) - FLOOR) / (CEIL - FLOOR)) * H;

/** Loudness-over-time strip from phase1.loudness_timeline.short_term, with the
 *  −14 LUFS stream reference gridline, the track's short-term max as a dashed
 *  line, and structure section dividers/labels overlaid. */
export function LoudnessTimelineCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const pts = timelinePoints(phase1?.loudness_timeline?.short_term, W, H, FLOOR, CEIL);
  if (pts.length === 0) return null;

  const line = pointsToPolyline(pts);
  const area = `0,${H} ${line} ${W},${H}`;
  const bands = segmentBands(phase1?.structure?.segments, phase1?.duration_seconds);
  const stMax = phase1?.short_term_max_lufs;

  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Loudness over time
        </span>
        <span className="meta">short-term LUFS</span>
      </div>
      <div className="card-body">
        <div className={s.timelineWrap}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.timelineSvg} aria-label="Short-term loudness over the track">
            {GRID_LUFS.map((g) => (
              <line key={g} x1={0} x2={W} y1={yFor(g)} y2={yFor(g)} className={s.tlGrid} />
            ))}
            {bands.map((b, i) =>
              i === 0 ? null : (
                <line key={i} x1={(b.leftPct / 100) * W} x2={(b.leftPct / 100) * W} y1={0} y2={H} className={s.tlDivider} />
              ),
            )}
            <polyline points={area} className={s.tlArea} />
            <polyline points={line} className={s.tlLine} />
            {stMax != null && <line x1={0} x2={W} y1={yFor(stMax)} y2={yFor(stMax)} className={s.tlRef} />}
          </svg>
          <StructureStrip structure={phase1?.structure} durationSec={phase1?.duration_seconds} />
        </div>
      </div>
    </section>
  );
}
