import { Link } from '@tanstack/react-router';

import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { fmtBpm, fmtDuration, fmtGenre } from './helpers/format';
import s from './SongHeader.module.css';

export interface SongHeaderInputs {
  mix: boolean;
  stems: boolean;
  als: boolean;
  reference: boolean;
}

interface SongHeaderProps {
  songId: string;
  versionId: string | null;
  trackName: string;
  versionLabel: string | null;
  genre: string | undefined;
  bpm: number | undefined;
  detectedKey: string | undefined;
  durationSeconds: number | undefined;
  inputs: SongHeaderInputs;
  /** Jump to the Files tab to attach more inputs / deepen. */
  onAddInputs: () => void;
  /** Publish the version to the public feed for crowd feedback. */
  onGetFeedback: () => void;
}

const INPUT_DEFS: { key: keyof SongHeaderInputs; label: string }[] = [
  { key: 'mix', label: 'Primary mix' },
  { key: 'stems', label: 'Stems' },
  { key: 'als', label: 'Ableton project' },
  { key: 'reference', label: 'Reference track' },
];

export function SongHeader({
  songId,
  versionId,
  trackName,
  versionLabel,
  genre,
  bpm,
  detectedKey,
  durationSeconds,
  inputs,
  onAddInputs,
  onGetFeedback,
}: SongHeaderProps) {
  const hue = hueFromId(versionId ?? songId);
  const attrs = [
    versionLabel,
    fmtGenre(genre),
    `${fmtBpm(bpm)} BPM`,
    detectedKey ?? '—',
    fmtDuration(durationSeconds),
  ].filter((x): x is string => Boolean(x) && x !== '—' );

  return (
    <header className={s.header}>
      <CoverArt hue={hue} size="lg" className={s.cover}>
        {versionLabel && <span className={s.coverBadge}>{versionLabel}</span>}
      </CoverArt>

      <div className={s.meta}>
        <h1 className={s.title}>{trackName}</h1>
        <p className={`mono ${s.attrs}`}>{attrs.join('  ·  ')}</p>

        <div className={s.inputs}>
          <span className={s.inputsLabel}>Analyzed from</span>
          {INPUT_DEFS.map(({ key, label }) => {
            const present = inputs[key];
            return (
              <button
                key={key}
                type="button"
                className={s.chip}
                data-present={present || undefined}
                onClick={present ? undefined : onAddInputs}
                disabled={present}
              >
                {present ? `✓ ${label}` : `+ ${label}`}
              </button>
            );
          })}
        </div>
      </div>

      <div className={s.actions}>
        {versionId ? (
          <Link
            to="/listen/$versionId"
            params={{ versionId }}
            className={`btn primary ${s.primary}`}
          >
            ▶ Open in Listen <span className={s.subtle}>try the fixes</span>
          </Link>
        ) : (
          <button type="button" className={`btn primary ${s.primary}`} disabled>
            ▶ Open in Listen
          </button>
        )}
        <button type="button" className={`btn ${s.secondary}`} onClick={onGetFeedback}>
          ♺ Get human feedback
        </button>
      </div>
    </header>
  );
}
