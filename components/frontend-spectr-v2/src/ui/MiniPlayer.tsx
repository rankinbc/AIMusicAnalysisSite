import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { useSongs } from '../api/hooks';
import { CoverArt } from './CoverArt';
import { hueFromId } from './hueFromId';
import { normalizeGrade, gradeColor } from '../features/results/helpers/grade';
import { pickMiniPlayerTrack } from './miniPlayerTrack';
import s from './MiniPlayer.module.css';

/**
 * UX-DR8 — persistent bottom MiniPlayer shell on product routes.
 *
 * This is the shell variant (Phase B): real audio playback lives on the
 * Listen page (features/listen), which this lane does not own. Rather than
 * fake a transport, every control here navigates to the real Listen page for
 * the most-recently-touched song's current version — the play button and the
 * "Open" button both expand into the full player. The waveform is decorative
 * (matches the canonical mockup). Hidden below 768px and when there is nothing
 * playable yet, so a brand-new library shows the designed empty state instead
 * of an empty transport bar.
 */
export function MiniPlayer() {
  const navigate = useNavigate();
  const { data: songs } = useSongs();

  const track = useMemo(() => pickMiniPlayerTrack(songs), [songs]);

  if (!track) return null;

  const { song, version } = track;
  const hue = hueFromId(song.id);
  const grade = normalizeGrade(song.latestResult?.grade);
  const meta = [
    song.genreHint,
    `v${version.versionNumber}`,
    song.latestResult?.score != null ? `${song.latestResult.score}/100` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const open = () => {
    void navigate({ to: '/listen/$versionId', params: { versionId: version.id } });
  };

  return (
    <div className={s.bar} role="region" aria-label="Mini player">
      <button
        type="button"
        className={s.play}
        onClick={open}
        title="Open in Listen"
        aria-label={`Play ${song.name} in the Listen player`}
      >
        ▶
      </button>

      <CoverArt hue={hue} size="sm" />

      <div className={s.meta}>
        <span className={s.name}>{song.name}</span>
        <span className={`mono ${s.sub}`}>{meta || 'no analysis yet'}</span>
      </div>

      <div className={s.wave} aria-hidden="true">
        {Array.from({ length: 96 }).map((_, i) => {
          const v =
            0.2 +
            (Math.sin(i * 0.4 + hue) * 0.5 + 0.5) * 0.6 +
            (Math.sin(i * 1.7) * 0.5 + 0.5) * 0.2;
          return <div key={i} style={{ height: `${Math.min(100, v * 100)}%` }} />;
        })}
      </div>

      {grade && (
        <span className={`mono ${s.grade}`} style={{ color: gradeColor(grade) }}>
          {grade}
        </span>
      )}

      <button type="button" className={`btn sm primary ${s.openBtn}`} onClick={open}>
        Open ↗
      </button>
    </div>
  );
}
