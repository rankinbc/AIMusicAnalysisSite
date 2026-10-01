import type { ChangeEvent, KeyboardEvent, Ref } from 'react';

import type { CoachCapsDto } from '../../api/types';
import { usePaidAction } from '../billing/CostTag';
import { Icon } from './Icon';
import { CoachGateInline } from './CoachGateInline';
import s from './CoachComposer.module.css';

// adhoc-coachchat-split (2026-09-19) — the gate/cap branch (CoachGateInline),
// the input + send/stop button, and the coach-cap line, extracted verbatim
// from CoachChat.tsx's `chatBody`.

interface CoachComposerProps {
  caps: CoachCapsDto | null;
  streaming: boolean;
  offlineState: boolean;
  input: string;
  setInput: (value: string) => void;
  send: () => void;
  handleStop: () => void;
  inputRef: Ref<HTMLInputElement>;
  specialistsRan: number;
  specialistsSuggested: number;
}

export function CoachComposer({
  caps,
  streaming,
  offlineState,
  input,
  setInput,
  send,
  handleStop,
  inputRef,
  specialistsRan,
  specialistsSuggested,
}: CoachComposerProps) {
  const { cost, guard } = usePaidAction('coachMessage');
  const guardedSend = () => guard(send);
  return (
    <>
      {caps?.capReached && !streaming ? (
        <div style={{ padding: '12px 14px 0' }}>
          <CoachGateInline />
        </div>
      ) : (
        <div className="coach-input">
          <input
            ref={inputRef}
            placeholder={offlineState ? 'Coach is offline' : 'Ask the coach about this mix…'}
            value={input}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter' && !streaming) {
                e.preventDefault();
                guardedSend();
              }
            }}
            disabled={offlineState}
            aria-label="Coach question input"
          />
          {streaming ? (
            <button
              type="button"
              className="send"
              onClick={handleStop}
              aria-label="Stop coach response"
            >
              <span aria-hidden>◼</span>
            </button>
          ) : (
            <button
              type="button"
              className="send"
              onClick={guardedSend}
              disabled={!input.trim() || offlineState}
              aria-label="Send question"
            >
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      )}
      {cost && !cost.included && !(caps?.capReached && !streaming) ? (
        <p className={s.costHint}>{cost.credits} ◆ per message</p>
      ) : null}

      <div className="coach-cap">
        grounded
        {caps &&
          (caps.limit >= 100000 ? (
            <> · unlimited messages today</>
          ) : (
            <>
              {' '}
              · <span className="v">{caps.used}</span>/{caps.limit} messages today
            </>
          ))}{' '}
        · {specialistsRan} specialists ran ·{' '}
        {Math.min(specialistsRan, specialistsSuggested)}/{specialistsSuggested} suggested
      </div>
    </>
  );
}
