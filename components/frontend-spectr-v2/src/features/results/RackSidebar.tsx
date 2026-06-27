import type { Move, MoveSev } from './move-model';

interface RackSidebarProps {
  versionId: string | null;
  /** All moves — the committed subset is resolved here. */
  moves: Move[];
  committedIds: ReadonlySet<string>;
  /** Remove a move from the Listen queue (toggle off). */
  onRemove: (move: Move) => void;
  /** Open the fix-detail modal (what the fix will do). */
  onOpenFix: (move: Move) => void;
  onAudition: () => void;
  coachMixState: 'idle' | 'generating' | 'ready';
  /** Open the compiled Coach Mix in a modal. */
  onOpenCoachMix: () => void;
  /** Open the Game Plan (.md export) modal. */
  onOpenGamePlan: () => void;
}

const SEV_VAR: Record<MoveSev, string> = {
  crit: 'var(--sev-critical)',
  warn: 'var(--sev-severe)',
  info: 'var(--sev-minor)',
  low: 'var(--sev-win)',
};

// The persistent right rail (prototype `.side`): the fixes queued for Listen, a
// compact Coach Mix entry (opens the rack in a modal), and the Game Plan card.
export function RackSidebar({
  versionId,
  moves,
  committedIds,
  onRemove,
  onOpenFix,
  onAudition,
  coachMixState,
  onOpenCoachMix,
  onOpenGamePlan,
}: RackSidebarProps) {
  const committed = moves.filter((m) => committedIds.has(m.id));

  return (
    <aside className="side">
      <div className="side-card">
        <div className="side-h">
          <span className="l">Fixes for Listen</span>
          <span className="hint">{committed.length}</span>
        </div>

        <div className="side-body">
          {coachMixState === 'ready' && committed.length > 0 && (
            <button type="button" className="coachmix-item" onClick={onOpenCoachMix}>
              <span className="cm-glyph" aria-hidden>
                ▣
              </span>
              <div className="cm-b">
                <div className="cm-t">Coach Mix</div>
                <div className="cm-s">
                  calculated rack · {committed.length} {committed.length === 1 ? 'fix' : 'fixes'} solved
                </div>
              </div>
              <span aria-hidden>→</span>
            </button>
          )}
          {coachMixState === 'generating' && (
            <div className="rack-empty">
              <span className="eqdots" aria-hidden>
                <i />
                <i />
                <i />
              </span>{' '}
              Compiling Coach Mix…
            </div>
          )}

          {committed.length === 0 ? (
            <div className="rack-empty">
              Check fixes in the plan — they&rsquo;ll queue here to apply on the Listen page.
            </div>
          ) : (
            committed.map((m) => (
              <div
                className="rack-item"
                key={m.id}
                role="button"
                tabIndex={0}
                title="See what this fix will do"
                onClick={() => onOpenFix(m)}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFix(m)}
              >
                <span className="ri-dot" style={{ background: SEV_VAR[m.sev] }} />
                <div className="ri-b">
                  <div className="ri-t">{m.title}</div>
                  {m.scope && <div className="ri-s">{m.scope}</div>}
                </div>
                <button
                  type="button"
                  className="ri-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(m);
                  }}
                  aria-label={`Remove ${m.title}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          className="rack-listen"
          onClick={onAudition}
          disabled={committed.length === 0 || !versionId}
        >
          <span aria-hidden>▶</span>
          <span>Open in Listen</span>
          {committed.length > 0 && <span className="rl-sub">try the fixes</span>}
        </button>
      </div>

      <button type="button" className="gameplan-card" onClick={onOpenGamePlan}>
        <span className="gpc-ic" aria-hidden>
          ⇣
        </span>
        <div className="gpc-b">
          <div className="gpc-t">Game Plan</div>
          <div className="gpc-s">Your plan compiled to take back to your DAW</div>
        </div>
        <span aria-hidden>→</span>
      </button>
      <p className="side-note">
        Checked fixes apply live on Listen. The Game Plan is a checklist for hand-mixing in your DAW.
      </p>
    </aside>
  );
}
