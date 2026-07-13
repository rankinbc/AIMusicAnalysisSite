import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { fmtGenre } from './helpers/format';
import { ResultsPlayer } from './ResultsPlayer';

export interface SongHeaderInputs {
  mix: boolean;
  stems: boolean;
  als: boolean;
  reference: boolean;
}

// Persistent header card (prototype `.rhead`): identity, the input roster we
// analyzed, a single neutral findings vital (no grade), and the inline player.
interface SongHeaderProps {
  songId: string;
  versionId: string | null;
  versionLabel: string | null;
  trackName: string;
  genre: string | null | undefined;
  durationSeconds: number | null | undefined;
  inputs: SongHeaderInputs;
  findingCount: number;
  suggestionCount: number;
  /** Story 12.5: the clicked chip's input key — the parent opens the matching
   *  real upload dialog (stems/.als/reference). Undefined = generic add. */
  onAddInputs: (key?: keyof SongHeaderInputs) => void;
}

const INPUT_DEFS: { key: keyof SongHeaderInputs; label: string; add: string }[] = [
  { key: 'mix', label: 'Primary mix', add: 'mix' },
  { key: 'stems', label: 'Stems', add: 'stems' },
  { key: 'als', label: 'Ableton project', add: '.als' },
  { key: 'reference', label: 'Reference', add: 'reference' },
];

export function SongHeader({
  songId,
  versionId,
  versionLabel,
  trackName,
  genre,
  durationSeconds,
  inputs,
  findingCount,
  suggestionCount,
  onAddInputs,
}: SongHeaderProps) {
  const hue = hueFromId(versionId ?? songId);
  const genreLabel = genre && genre !== 'other' ? fmtGenre(genre) : null;

  return (
    <div className="rhead">
      <div className="rh-top">
        <CoverArt hue={hue} size="md">
          {versionLabel && <span className="rh-cover-badge">{versionLabel}</span>}
        </CoverArt>

        <div className="rh-titles">
          <div className="rh-titlerow">
            <span className="rh-name">{trackName}</span>
            {versionLabel && <span className="rh-ver">{versionLabel}</span>}
          </div>
          {genreLabel && <div className="rh-genre">{genreLabel}</div>}

          <div className="rh-chips">
            <span className="rh-chips-label">Analyzed from</span>
            {INPUT_DEFS.map(({ key, label, add }) => {
              const present = inputs[key];
              if (present) {
                return (
                  <span key={key} className="chip on">
                    ✓ {label}
                  </span>
                );
              }
              return (
                <button key={key} type="button" className="chip add" onClick={() => onAddInputs(key)}>
                  <span className="pl">+</span> Add {add}
                </button>
              );
            })}
          </div>
        </div>

        <FindingsVital findingCount={findingCount} suggestionCount={suggestionCount} />
      </div>

      <ResultsPlayer versionId={versionId} durationSeconds={durationSeconds} />
    </div>
  );
}

function FindingsVital({
  findingCount,
  suggestionCount,
}: {
  findingCount: number;
  suggestionCount: number;
}) {
  if (findingCount === 0) {
    return (
      <div className="rh-vital clean">
        <div className="vtxt">
          <span className="vn">No issues</span>
          <span className="vs">clean mix</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rh-vital">
      <div className="vtxt">
        <span className="vn">
          <span className="num">{findingCount}</span> {findingCount === 1 ? 'finding' : 'findings'}
        </span>
        <span className="vs">
          <span className="fx">{suggestionCount}</span>{' '}
          {suggestionCount === 1 ? 'suggestion' : 'suggestions'}
        </span>
      </div>
    </div>
  );
}
