import type { ReactNode, Ref } from 'react';

import { Pill } from '../../ui/Pill';
import { StreamCaret, TypingDots } from './CoachResponding';
import { EvidenceChips } from './EvidenceChips';
import { resolveUnlockAction, type ChatTurn } from './coach-chat-helpers';
import s from './CoachChat.module.css';

// adhoc-coachchat-split (2026-09-19) — the thread markup extracted from
// CoachChat.tsx's `chatBody`: greeting, turn bubbles, role labels, the
// Teach badge, TypingDots/StreamCaret, EvidenceChips, and the unlock row.
// Pure move — same JSX, same classes, same conditions.

interface CoachThreadProps {
  turns: ChatTurn[];
  streaming: boolean;
  expanded: boolean;
  greeting?: ReactNode;
  handleUnlock: (intent: string) => void;
  threadRef: Ref<HTMLDivElement>;
}

export function CoachThread({
  turns,
  streaming,
  expanded,
  greeting,
  handleUnlock,
  threadRef,
}: CoachThreadProps) {
  return (
    <div
      className={expanded ? `coach-thread ${s.dialogThread}` : 'coach-thread'}
      ref={threadRef}
    >
      {turns.length === 0 && greeting && (
        <div className="cmsg bot">
          <div className="bub">{greeting}</div>
        </div>
      )}
      {turns.map((turn, i) => {
        const isAssistant = turn.role === 'assistant';
        // The reply in flight: dots until the first token, then a caret.
        const isLive = isAssistant && !turn.finalized && streaming && i === turns.length - 1;
        const unlock = turn.refused ? resolveUnlockAction(turn.refusalReason) : null;
        return (
          <div key={i} className={`cmsg ${isAssistant ? 'bot' : 'user'}`}>
            <span className="cm-role">{isAssistant ? 'Coach' : 'You'}</span>
            {isAssistant && turn.mode === 'teach' && (
              <span className="cm-teach-badge">
                <Pill tone="violet">Teach</Pill>
              </span>
            )}
            <div className="bub">
              {turn.text}
              {isLive && (turn.text ? <StreamCaret /> : <TypingDots />)}
              {isAssistant && turn.finalized && turn.evidence && turn.evidence.length > 0 && (
                <EvidenceChips evidence={turn.evidence} />
              )}
              {isAssistant && turn.finalized && turn.refused && unlock && (
                <div className={s.unlockRow}>
                  <button
                    type="button"
                    className={s.unlockBtn}
                    onClick={() => handleUnlock(unlock.intent)}
                    aria-label={`Unlock: ${unlock.label}`}
                  >
                    <Pill tone="violet">{unlock.label}</Pill>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
