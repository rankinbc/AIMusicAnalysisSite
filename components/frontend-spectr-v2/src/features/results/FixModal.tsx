import type { Move, MoveSev } from './move-model';
import { RackModules } from './RackModules';

interface FixModalProps {
  move: Move;
  /** Remove the fix from the Listen queue. */
  onRemove: (move: Move) => void;
  onClose: () => void;
}

const SEV_VAR: Record<MoveSev, string> = {
  crit: 'var(--sev-critical)',
  warn: 'var(--sev-severe)',
  info: 'var(--sev-minor)',
  low: 'var(--sev-win)',
};

const SEV_LABEL: Record<MoveSev, string> = {
  crit: 'Critical',
  warn: 'Severe',
  info: 'Minor',
  low: 'Win',
};

// "Click a queued fix to see what it will do" — the fix detail: the directive +
// the rack settings the fix compiles to, queued to apply on the Listen page.
export function FixModal({ move, onRemove, onClose }: FixModalProps) {
  const directional = !move.hasParams;
  const hasSteps = move.hasParams && move.steps.length > 0;
  const sev = SEV_VAR[move.sev];

  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ width: 'min(540px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={move.title}
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">Fix · {move.scope || 'mix'}</div>
            <div className="mn">{move.title}</div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="move-prob" style={{ marginBottom: 14, ['--sev' as string]: sev }}>
            <span className="mp-dot" />
            <span className="mp-head" style={{ color: 'var(--text-2)' }}>
              {move.source}
            </span>
            <span className="mp-spacer" />
            <span className="mp-sev">{SEV_LABEL[move.sev]}</span>
          </div>

          <div className={`directive${directional ? ' directional' : ''}`}>
            <span className="arrow" aria-hidden>
              →
            </span>
            <div className="d-text">{directional ? move.directional : move.directive}</div>
          </div>

          {hasSteps && (
            <div style={{ marginTop: 16 }}>
              <div className="pb-h">Rack settings</div>
              <RackModules steps={move.steps} />
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="mf-note">
            Queued to apply on the <span className="v">Listen</span> page
          </span>
          <button
            type="button"
            className="rack-toggle on"
            onClick={() => {
              onRemove(move);
              onClose();
            }}
          >
            ✕ Remove
          </button>
        </div>
      </div>
    </div>
  );
}
