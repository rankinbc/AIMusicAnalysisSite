/* Story 11.11 AC1/AC4 — unit coverage for the pure mention token helpers.
 * The grammar must mirror the BFF MentionParser or suggestions would produce
 * mentions the parser never resolves. */
import { describe, expect, it } from 'vitest';

import { activeMentionQuery, applyMention } from '../mention-helpers';

describe('activeMentionQuery', () => {
  it('detects a bare @ and a partial token at the caret', () => {
    expect(activeMentionQuery('hey @', 5)).toEqual({ start: 4, query: '' });
    expect(activeMentionQuery('hey @aur', 8)).toEqual({ start: 4, query: 'aur' });
    expect(activeMentionQuery('@aur', 4)).toEqual({ start: 0, query: 'aur' }); // start of text
  });

  it('tracks the token the caret is inside, not just at the end', () => {
    // caret between 'a' and 'u' → query is what's typed so far left of caret
    expect(activeMentionQuery('hey @aur ok', 6)).toEqual({ start: 4, query: 'a' });
  });

  it('never triggers inside an email (MentionParser boundary rule)', () => {
    expect(activeMentionQuery('mail me a@b', 11)).toBeNull();
  });

  it('never triggers mid-word or after a second @', () => {
    expect(activeMentionQuery('c@@x', 4)).toBeNull();
    expect(activeMentionQuery('word@x', 6)).toBeNull();
  });

  it('rejects tokens that start non-alphanumeric or exceed 30 chars', () => {
    expect(activeMentionQuery('hey @.x', 7)).toBeNull();
    const long = 'hey @' + 'a'.repeat(31);
    expect(activeMentionQuery(long, long.length)).toBeNull();
  });

  it('returns null when the caret has left the token', () => {
    expect(activeMentionQuery('hey @aur done', 13)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces the active token, reusing an existing following space', () => {
    const r = applyMention('hey @aur nice one', { start: 4, query: 'aur' }, 'aurora');
    expect(r.text).toBe('hey @aurora nice one');
    expect(r.caret).toBe('hey @aurora '.length);
  });

  it('appends a space at end-of-text and on a bare @', () => {
    const r = applyMention('cc @', { start: 3, query: '' }, 'kepler');
    expect(r.text).toBe('cc @kepler ');
    expect(r.caret).toBe('cc @kepler '.length);
  });

  it('replaces the WHOLE token when picking from a mid-token caret', () => {
    // caret after '@a' (query 'a') inside token 'aur' — the tail 'ur' must not survive
    const r = applyMention('hey @aur ok', { start: 4, query: 'a' }, 'aurora');
    expect(r.text).toBe('hey @aurora ok');
  });
});

describe('unicode boundary parity with MentionParser', () => {
  it("does not trigger after a non-ASCII word char (é@aur — .NET \\w is unicode)", () => {
    expect(activeMentionQuery('é@aur', 5)).toBeNull();
  });
});
