import { Link } from '@tanstack/react-router';

import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import s from './SongHeader.module.css';

export interface SongHeaderInputs {
  mix: boolean;
  stems: boolean;
  als: boolean;
  reference: boolean;
}

// Identity (track name, genre, BPM, key, grade) leads the report in
// VerdictHero. This header is the complementary "what we analyzed + what to do
// next" strip: cover, the input roster, and the primary actions.
interface SongHeaderProps {
  songId: string;
  versionId: string | null;
  versionLabel: string | null;
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
  versionLabel,
  inputs,
  onAddInputs,
  onGetFeedback,
}: SongHeaderProps) {
  const hue = hueFromId(versionId ?? songId);

  return (
    <header className={s.header}>
      <CoverArt hue={hue} size="lg" className={s.cover}>
        {versionLabel && <span className={s.coverBadge}>{versionLabel}</span>}
      </CoverArt>

      <div className={s.meta}>
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
