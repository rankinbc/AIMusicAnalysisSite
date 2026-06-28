import { describe, expect, it } from 'vitest';

import { tokenizeTrackNames } from '../track-highlight';

// FR12 verdict-text tokenizer: highlights exact .als track names, nothing else.
describe('tokenizeTrackNames', () => {
  it('returns a single text segment when there are no names', () => {
    expect(tokenizeTrackNames('Robotic velocities', [])).toEqual([
      { type: 'text', value: 'Robotic velocities' },
    ]);
    expect(tokenizeTrackNames('x', undefined)).toEqual([{ type: 'text', value: 'x' }]);
    expect(tokenizeTrackNames('x', null)).toEqual([{ type: 'text', value: 'x' }]);
  });

  it('wraps an exact track-name occurrence and keeps the surrounding text', () => {
    expect(tokenizeTrackNames('Robotic velocities (SUB-DEEP)', ['SUB-DEEP'])).toEqual([
      { type: 'text', value: 'Robotic velocities (' },
      { type: 'track', value: 'SUB-DEEP' },
      { type: 'text', value: ')' },
    ]);
  });

  it('highlights multiple distinct names', () => {
    const segs = tokenizeTrackNames('flat on Lead and Bass parts', ['Lead', 'Bass']);
    expect(segs.filter((s) => s.type === 'track').map((s) => s.value)).toEqual(['Lead', 'Bass']);
  });

  it('prefers the longest name when one contains another', () => {
    const segs = tokenizeTrackNames('Bass Sub is flat', ['Bass', 'Bass Sub']);
    expect(segs[0]).toEqual({ type: 'track', value: 'Bass Sub' });
  });

  it('does not fuzzy-match — a name absent from the text yields plain text only', () => {
    expect(tokenizeTrackNames('no tracks here', ['Kick'])).toEqual([
      { type: 'text', value: 'no tracks here' },
    ]);
  });

  it('is case-sensitive (a "Bass" track does not light up the word "bass")', () => {
    expect(tokenizeTrackNames('the bass is muddy', ['Bass'])).toEqual([
      { type: 'text', value: 'the bass is muddy' },
    ]);
  });
});
