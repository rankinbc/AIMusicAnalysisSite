import { useState } from 'react';

import type { SuggestionDto } from '../../api/types';
import { canActOnSuggestion, chainSummary, chainToMoves } from './suggestion-helpers';
import { useAcceptSuggestion, useRejectSuggestion } from './useSuggestions';
import s from './SuggestionCard.module.css';

const STATUS_LABEL: Record<SuggestionDto['status'], string> = {
  proposed: 'proposed',
  auditioned: 'auditioned',
  accepted: '✓ accepted',
  rejected: 'rejected',
};

/** Story 11.12 — audition seam threaded from the page (which owns the audio
 *  graph). Absent when the card mounts somewhere without a live rack. */
export interface SuggestionAuditionSeam {
  /** Suggestion id currently auditioning (one at a time), or null. */
  activeId: string | null;
  onAudition: (sg: SuggestionDto) => void;
  onRevert: () => void;
  /** True while fork-to-suggest is engaged — overlapping snapshots corrupt restore. */
  disabled: boolean;
}

interface SuggestionCardProps {
  suggestion: SuggestionDto;
  versionId: string;
  isOwner: boolean;
  audition?: SuggestionAuditionSeam;
}

/**
 * Story 11.2 — one reviewer-proposed rack chain. Shows the chain summary, status,
 * and provenance; the owner can Accept (server forks a RackPreset — the accept hook
 * invalidates the preset list so it appears) or Reject. Story 11.12 adds a
 * non-destructive Audition/Revert (when the page threads its graph seam) and an
 * expandable readable move list.
 */
export function SuggestionCard({ suggestion, versionId, isOwner, audition }: SuggestionCardProps) {
  const acceptMut = useAcceptSuggestion(versionId);
  const rejectMut = useRejectSuggestion(versionId);
  const [showMoves, setShowMoves] = useState(false);

  const summary = chainSummary(suggestion.chain);
  const moves = chainToMoves(suggestion.chain);
  const from = suggestion.fromActor.handle ?? suggestion.fromActor.displayName ?? 'anon';
  const canAct = canActOnSuggestion(suggestion.status, isOwner);
  const busy = acceptMut.isPending || rejectMut.isPending;
  const auditioning = audition?.activeId === suggestion.id;

  return (
    <div className={s.card} data-status={suggestion.status}>
      <div className={s.head}>
        <span className={s.from}>⌁ {suggestion.fromActor.type === 'anon' ? from : '@' + from} suggested a rack</span>
        <span className={s.status}>{STATUS_LABEL[suggestion.status]}</span>
      </div>

      {summary.length > 0 ? (
        <div className={s.chain}>
          {summary.map((mod, i) => (
            <span key={i} className={s.mod}>{mod}</span>
          ))}
        </div>
      ) : (
        <div className={s.chainEmpty}>chain unavailable</div>
      )}

      {suggestion.createdInSessionId && (
        <div className={s.prov}>proposed live in a room</div>
      )}

      {moves.length > 0 && (
        <div>
          <button
            type="button"
            className="mono"
            style={{ fontSize: 9, color: 'var(--cyan)', background: 'none', padding: 0, marginTop: 6 }}
            onClick={() => setShowMoves((v) => !v)}
          >
            {showMoves ? 'hide moves' : `show moves (${moves.length})`}
          </button>
          {showMoves && (
            <ul className="mono" data-testid="suggestion-moves" style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: 9.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
              {moves.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}

      {(canAct || audition) && (
        <div className={s.actions}>
          {canAct && (
            <>
              <button
                type="button"
                className="btn sm primary"
                disabled={busy}
                onClick={() => acceptMut.mutate(suggestion.id)}
              >
                {acceptMut.isPending ? 'Accepting…' : '✦ Accept → preset'}
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => rejectMut.mutate(suggestion.id)}
              >
                Reject
              </button>
            </>
          )}
          {audition && (auditioning ? (
            <button type="button" className="btn sm" onClick={audition.onRevert}>
              ↩ Revert audition
            </button>
          ) : (
            <button
              type="button"
              className="btn sm"
              disabled={audition.disabled}
              title={audition.disabled ? 'Finish your suggestion first' : 'Hear this chain on the rack'}
              onClick={() => audition.onAudition(suggestion)}
            >
              ▶ Audition
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
