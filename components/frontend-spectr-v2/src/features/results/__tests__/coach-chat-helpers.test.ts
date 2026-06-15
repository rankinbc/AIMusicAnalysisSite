import { describe, expect, it } from 'vitest';

import type { CoachEvidenceDto } from '../../../api/types';
import {
  appendToLastAssistant,
  finalizeLastAssistant,
  finalizeOrTrimOnAbort,
  resolveUnlockAction,
  trimEmptyPending,
  type ChatTurn,
} from '../coach-chat-helpers';

// Story 1.8 / Task 6.4 + 7.4 / code-review P19 — these helpers carry the
// load-bearing state-machine logic for the CoachChat transcript. Pure
// functional, so we cover them at the helper level rather than threading
// React state through renderToStaticMarkup.

function makeTurns(...rows: Array<Partial<ChatTurn> & { role: ChatTurn['role'] }>): ChatTurn[] {
  return rows.map((r) => ({ text: '', ...r }));
}

describe('appendToLastAssistant', () => {
  it('appends delta to the last assistant turn', () => {
    const out = appendToLastAssistant(
      makeTurns({ role: 'user', text: 'Q' }, { role: 'assistant', text: 'hel' }),
      'lo',
    );
    expect(out[out.length - 1].text).toBe('hello');
  });

  it('is a no-op when the last turn is a user message', () => {
    const turns = makeTurns({ role: 'user', text: 'Q' });
    expect(appendToLastAssistant(turns, 'x')).toBe(turns);
  });

  it('is a no-op when the list is empty', () => {
    expect(appendToLastAssistant([], 'x')).toEqual([]);
  });
});

describe('finalizeLastAssistant', () => {
  it('sets finalized=true and attaches evidence', () => {
    const ev: CoachEvidenceDto[] = [{ label: 'LUFS −11', path: 'verdict-x' }];
    const out = finalizeLastAssistant(
      makeTurns({ role: 'assistant', text: 'hello', finalized: false }),
      { evidence: ev },
    );
    const last = out[out.length - 1];
    expect(last.finalized).toBe(true);
    expect(last.evidence).toEqual(ev);
  });

  it('replaces text when replaceText is provided (refusal/error path)', () => {
    const out = finalizeLastAssistant(
      makeTurns({ role: 'assistant', text: 'partial', finalized: false }),
      { replaceText: 'I do not have stems.', refused: true, refusalReason: 'missing_data' },
    );
    const last = out[out.length - 1];
    expect(last.text).toBe('I do not have stems.');
    expect(last.refused).toBe(true);
    expect(last.refusalReason).toBe('missing_data');
  });

  it('preserves existing text when replaceText is undefined (done path)', () => {
    const out = finalizeLastAssistant(
      makeTurns({ role: 'assistant', text: 'streamed body' }),
      { evidence: [] },
    );
    expect(out[out.length - 1].text).toBe('streamed body');
  });
});

describe('trimEmptyPending', () => {
  it('drops the last turn when it is an empty assistant placeholder', () => {
    const out = trimEmptyPending(
      makeTurns({ role: 'user', text: 'Q' }, { role: 'assistant', text: '', finalized: false }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('keeps non-empty assistant turns', () => {
    const turns = makeTurns({ role: 'assistant', text: 'something' });
    expect(trimEmptyPending(turns)).toBe(turns);
  });
});

describe('finalizeOrTrimOnAbort (code-review P4)', () => {
  it('drops empty pending turn when abort fires before any tokens', () => {
    const out = finalizeOrTrimOnAbort(
      makeTurns({ role: 'user', text: 'Q' }, { role: 'assistant', text: '' }),
    );
    expect(out).toHaveLength(1);
  });

  it('finalizes partial-text turn with a "(stopped)" marker', () => {
    const out = finalizeOrTrimOnAbort(
      makeTurns({ role: 'assistant', text: 'partial answer' }),
    );
    const last = out[out.length - 1];
    expect(last.finalized).toBe(true);
    expect(last.text).toContain('partial answer');
    expect(last.text).toMatch(/stopped/i);
  });
});

describe('resolveUnlockAction (AC5 / UX-DR17)', () => {
  it('maps "missing_data" to an Add-stems intent', () => {
    expect(resolveUnlockAction('missing_data')).toEqual({
      label: 'Add stems',
      intent: 'add_stems',
    });
  });

  it('returns null for "out_of_scope" refusals (no unlock)', () => {
    expect(resolveUnlockAction('out_of_scope')).toBeNull();
  });

  it('returns null for null / undefined reasons', () => {
    expect(resolveUnlockAction(null)).toBeNull();
    expect(resolveUnlockAction(undefined)).toBeNull();
  });

  it('returns null for unknown reasons (safe default)', () => {
    expect(resolveUnlockAction('mystery_reason')).toBeNull();
  });
});
