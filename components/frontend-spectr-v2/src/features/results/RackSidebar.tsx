import { useEffect, useState } from 'react';

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
  /** Open the compiled Fix Rack in a modal. */
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
// compact Fix Rack entry (opens the rack in a modal), and the Game Plan card.
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

  // Story 5.10 (UX-DR45): the rail card is a <details> accordion when the
  // layout stacks (<1024). LIVE viewport tracking (review finding: an
  // init-only read stranded the rail collapsed after a mobile→desktop
  // rotation, and pointer-events:none blocks mouse but NOT keyboard — the
  // summary must be truly inert on desktop: forced open + out of tab order).
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () =>
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // Mobile starts folded; desktop is forced open regardless.
  const [railOpen, setRailOpen] = useState(false);
  const open = isDesktop || railOpen;

  return (
    <aside className="side">
      <details
        className="side-card"
        open={open}
        onToggle={(e) => {
          const next = (e.currentTarget as HTMLDetailsElement).open;
          if (!isDesktop) setRailOpen(next);
          // Desktop: controlled `open` (isDesktop → true) re-asserts itself;
          // any programmatic toggle is a no-op by construction.
        }}
      >
        <summary
          className="side-h"
          tabIndex={isDesktop ? -1 : 0}
          onClick={(e) => {
            if (isDesktop) e.preventDefault();
          }}
        >
          <span className="l">Fixes for Listen</span>
          <span className="hint">{committed.length}</span>
        </summary>

        <div className="side-body">
          {coachMixState === 'ready' && committed.length > 0 && (
            <button type="button" className="coachmix-item" onClick={onOpenCoachMix}>
              <span className="cm-glyph" aria-hidden>
                ▣
              </span>
              <div className="cm-b">
                <div className="cm-t">Fix Rack</div>
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
              Compiling Fix Rack…
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
      </details>

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
