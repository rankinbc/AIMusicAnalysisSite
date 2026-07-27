import {
  useAcceptSuggestion,
  useRejectSuggestion,
  useSuggestions,
} from '../listen/useSuggestions';
import { Icon } from './Icon';
import { actorLabel } from './feedback-timeline-model';
import { enabledModuleIds } from './fix-rack-helpers';

// Reviewer suggestions surfaced in the Actions list (v4): proposed rack chains
// from listeners. Accept forks the chain into the owner's preset library;
// reject just closes it. Chain preview = enabled module names (OpRack renders
// ops, not chains — deliberately not reused here).

export function SuggestionRows({ versionId }: { versionId: string }) {
  const { data } = useSuggestions(versionId);
  const accept = useAcceptSuggestion(versionId);
  const reject = useRejectSuggestion(versionId);
  const proposed = (data ?? []).filter((s) => s.status === 'proposed');
  if (proposed.length === 0) return null;

  return (
    <div>
      <div className="fb-sevhd" style={{ ['--sev' as string]: 'var(--violet)' }}>
        <span className="d" />
        listener suggestions
        <span className="c">{proposed.length}</span>
      </div>
      {proposed.map((s) => {
        const mods = enabledModuleIds(s.chain);
        return (
          <div className="fb-row sug" key={s.id} style={{ ['--sev' as string]: 'var(--violet)' }}>
            <span className="fr-dot" />
            <span className="fr-b">
              <span className="fr-head">Suggested by {actorLabel(s.fromActor)}</span>
              <span className="fr-meta mono">
                {mods.length > 0 ? mods.join(' · ') : 'rack chain'}
              </span>
            </span>
            <span className="fr-acts" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="fr-ic gloss"
                disabled={accept.isPending}
                onClick={() => accept.mutate(s.id)}
              >
                <Icon name="check" size={13} />
                <span className="gtip">Accept — becomes a preset in your library</span>
              </button>
              <button
                type="button"
                className="fr-ic gloss"
                disabled={reject.isPending}
                onClick={() => reject.mutate(s.id)}
              >
                <Icon name="x" size={13} />
                <span className="gtip">Reject this suggestion</span>
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
