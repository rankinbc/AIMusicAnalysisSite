/* The Listen stage's analysis board.
 *
 * Spec D1/D2: the report's own FixBoard, mounted on the `listen` surface —
 * read-only toward the server, and "apply" means the LIVE RACK. Everything it
 * needs arrives as props; the data and the single fix overlay live in
 * useListenFindings, one level up.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';

import { Icon } from '../../results/Icon';
import { FixBoard, type FixBoardMode } from '../../results/FixBoard';
import type { SeekAffordance } from '../../results/fix-board-helpers';
import type { Move } from '../../results/move-model';
import type { CarryPhase } from '../useFixCarryOver';
import { applyGate, timeRangeOf } from './findings-helpers';
import type { ListenFindings } from './useListenFindings';

const NO_NOTES: ReadonlySet<string> = new Set<string>();

export function FindingsStage({
  findings, songId, durationSeconds, onSeek, carryPhase, onClearPreset,
}: {
  findings: ListenFindings;
  /** For the no-analysis link. Undefined only on the mock demo route. */
  songId: string | undefined;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
  carryPhase: CarryPhase;
  onClearPreset: () => void;
}) {
  // Actions first: the Listen page's verb is "apply".
  const [mode, setMode] = useState<FixBoardMode>('actions');
  const [focusId, setFocusId] = useState<string | null>(null);
  const gate = applyGate(carryPhase);

  const seek = useMemo<SeekAffordance>(() => ({
    label: (v) => timeRangeOf(v, durationSeconds)?.label ?? null,
    go: (v) => {
      const t = timeRangeOf(v, durationSeconds);
      if (t) onSeek(t.start);
    },
  }), [durationSeconds, onSeek]);

  const { overlay, appliedIds } = findings;
  const onToggleCommit = useCallback((move: Move) => {
    if (!gate.enabled) return;
    overlay.toggle(move.id);
  }, [gate.enabled, overlay]);

  const onShowFix = useCallback((verdictId: string) => {
    setFocusId(verdictId);
    setMode('actions');
  }, []);
  const onShowFinding = useCallback((verdictId: string) => {
    setFocusId(verdictId);
    setMode('findings');
  }, []);
  const onConsumeFocus = useCallback(() => setFocusId(null), []);
  // Fix-less "notes" are a report concept (they live on the report's Actions
  // tab). The listen surface hides the control, so this is never called.
  const onToggleNote = useCallback(() => {}, []);

  if (findings.status === 'no-analysis') {
    return (
      <div className="lr-stage-msg" data-testid="listen-findings-empty">
        <Icon name="info" size={16} />
        <span>
          This version hasn&rsquo;t been analyzed yet — there are no findings to show.
        </span>
        {songId && (
          <Link to="/songs/$songId" params={{ songId }} className="btn sm primary">
            Open this song to analyze it
          </Link>
        )}
      </div>
    );
  }

  if (findings.status === 'loading') {
    return (
      <div className="lr-stage-msg mono" data-testid="listen-findings-loading">
        Loading findings…
      </div>
    );
  }

  if (findings.status === 'error') {
    return (
      <div className="lr-stage-msg" data-testid="listen-findings-error">
        <Icon name="info" size={16} />
        <span>Couldn&rsquo;t load the findings for this version.</span>
        <button type="button" className="btn sm" onClick={findings.retry}>Retry</button>
      </div>
    );
  }

  return (
    <div className="lr-stage-board">
      {/* Two plain buttons with a pressed state, not a tablist: neither one
          controls a tabpanel and there is no arrow-key roving, so `role="tab"`
          promised a keyboard contract this never implemented. Colour alone
          carried the state before. */}
      <div className="lr-seg lr-stage-modes" role="group" aria-label="Board view">
        <button
          type="button"
          aria-pressed={mode === 'actions'}
          className={mode === 'actions' ? 'on' : ''}
          onClick={() => setMode('actions')}
        >
          Actions
        </button>
        <button
          type="button"
          aria-pressed={mode === 'findings'}
          className={mode === 'findings' ? 'on' : ''}
          onClick={() => setMode('findings')}
        >
          Findings
        </button>
        {gate.reason && (
          // role="status": the reason CHANGES while you stand here ("Loading
          // the carried fix rack…" → "A fix preset is loaded…") and it is the
          // only explanation for why every apply control just went dead.
          <span className="lr-stage-gate" role="status">
            <Icon name="info" size={12} />
            {gate.reason}
            {gate.showClearPreset && (
              <button type="button" className="btn sm" onClick={onClearPreset}>
                Clear preset
              </button>
            )}
          </span>
        )}
      </div>
      <FixBoard
        mode={mode}
        surface="listen"
        seek={seek}
        verdicts={findings.verdicts}
        moves={findings.moves}
        committedIds={appliedIds}
        onToggleCommit={onToggleCommit}
        checkedNoteIds={NO_NOTES}
        onToggleNote={onToggleNote}
        focusId={focusId}
        onConsumeFocus={onConsumeFocus}
        onShowFix={onShowFix}
        onShowFinding={onShowFinding}
        applyLocked={!gate.enabled}
      />
    </div>
  );
}
