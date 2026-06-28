import type { SuggestionDto } from '../../api/types';
import { canActOnSuggestion, chainSummary } from './suggestion-helpers';
import { useAcceptSuggestion, useRejectSuggestion } from './useSuggestions';
import s from './SuggestionCard.module.css';

const STATUS_LABEL: Record<SuggestionDto['status'], string> = {
  proposed: 'proposed',
  auditioned: 'auditioned',
  accepted: '✓ accepted',
  rejected: 'rejected',
};

interface SuggestionCardProps {
  suggestion: SuggestionDto;
  versionId: string;
  isOwner: boolean;
}

/**
 * Story 11.2 — one reviewer-proposed rack chain. Shows the chain summary, status,
 * and provenance; the owner can Accept (server forks a RackPreset — the accept hook
 * invalidates the preset list so it appears) or Reject.
 */
export function SuggestionCard({ suggestion, versionId, isOwner }: SuggestionCardProps) {
  const acceptMut = useAcceptSuggestion(versionId);
  const rejectMut = useRejectSuggestion(versionId);

  const summary = chainSummary(suggestion.chain);
  const from = suggestion.fromActor.handle ?? suggestion.fromActor.displayName ?? 'anon';
  const canAct = canActOnSuggestion(suggestion.status, isOwner);
  const busy = acceptMut.isPending || rejectMut.isPending;

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

      {canAct && (
        <div className={s.actions}>
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
        </div>
      )}
    </div>
  );
}
