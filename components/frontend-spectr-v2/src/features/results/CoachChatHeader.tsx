import type { ReactNode } from 'react';

import { TranceBot } from './TranceBot';

export type CoachMode = 'Concise' | 'Normal' | 'Teach';

const MODES: readonly CoachMode[] = ['Concise', 'Normal', 'Teach'];

interface CoachChatHeaderProps {
  /** Drives the TranceBot avatar's "actively responding" animation. */
  thinking: boolean;
  mode: CoachMode;
  onModeChange: (mode: CoachMode) => void;
  /** Coach Mix / Specialists buttons, owned by the parent (CoachTab). */
  headerActions?: ReactNode;
  /** Fix round 1 (2026-09-19) — CoachChat mounts exactly one instance of
   *  this header inline (collapsed) and a separate instance inside
   *  CoachChatDialog (expanded); each needs its own trailing control (the
   *  Expand button inline, the dialog's Collapse button when expanded), so
   *  it's a required prop rather than something this component decides for
   *  itself. Pure presentational component — no state of its own. */
  trailingAction: ReactNode;
}

/** "Ask the Coach" header bar: avatar, title, Concise/Normal/Teach mode
 *  toggle, headerActions, and a trailing control. Extracted from
 *  CoachChat.tsx (fix round 1, 2026-09-19) as the single source of the
 *  header markup — CoachChat.tsx instantiates it wherever the header needs
 *  to live, instead of duplicating the mode toggle / headerActions JSX. */
export function CoachChatHeader({
  thinking,
  mode,
  onModeChange,
  headerActions,
  trailingAction,
}: CoachChatHeaderProps) {
  return (
    <div className="coach-hd">
      <TranceBot size={26} thinking={thinking} />
      <div className="ch-b">
        <div className="ch-k">
          <span className="led" />
          <span className="lab">Ask the Coach</span>
          <span className="ch-modes">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={`ch-mode${mode === m ? ' on' : ''}`}
                onClick={() => onModeChange(m)}
              >
                {m}
              </button>
            ))}
          </span>
        </div>
        <div className="ch-sub">I know everything about this song.</div>
      </div>
      {headerActions && <div className="coach-actions">{headerActions}</div>}
      {trailingAction}
    </div>
  );
}
