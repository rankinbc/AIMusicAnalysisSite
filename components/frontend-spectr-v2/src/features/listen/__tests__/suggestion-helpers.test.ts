import { describe, expect, it } from 'vitest';

import type { SuggestionDto } from '../../../api/types';
import { canActOnSuggestion, chainSummary, chainToMoves, partitionSuggestions } from '../suggestion-helpers';

function sg(over: Partial<SuggestionDto>): SuggestionDto {
  return {
    id: 's1',
    songVersionId: 'v1',
    fromActor: { type: 'user', userId: 'u', handle: 'vela', displayName: null, hue: 220 },
    chain: { order: ['eq', 'glue_compressor'], modules: {}, masterBypass: false },
    commentId: null,
    createdInSessionId: null,
    status: 'proposed',
    createdAt: '2026-06-28T00:00:00Z',
    ...over,
  };
}

describe('chainSummary', () => {
  it('prettifies the chain order into module labels', () => {
    expect(chainSummary({ order: ['eq', 'glue_compressor'] })).toEqual(['Eq', 'Glue Compressor']);
  });
  it('returns [] for a malformed/empty chain', () => {
    expect(chainSummary(null)).toEqual([]);
    expect(chainSummary({})).toEqual([]);
    expect(chainSummary({ order: 'nope' })).toEqual([]);
  });
});

describe('partitionSuggestions', () => {
  it('splits comment-linked from standalone suggestions', () => {
    const { byCommentId, standalone } = partitionSuggestions([
      sg({ id: 'a', commentId: 'c1' }),
      sg({ id: 'b', commentId: null }),
    ]);
    expect(byCommentId.get('c1')?.id).toBe('a');
    expect(standalone.map((s) => s.id)).toEqual(['b']);
  });
});

describe('chainToMoves (story 11.12)', () => {
  it('formats EQ cuts/boosts, comp, width and trim as readable moves', () => {
    const moves = chainToMoves({
      order: ['eq', 'comp', 'ms', 'trim'],
      modules: {
        eq: {
          enabled: true,
          bands: [
            { type: 'peaking', freq: 120, gainDb: -2.1, q: 1.4, enabled: true },
            { type: 'highshelf', freq: 10000, gainDb: 1.5, q: 0.7, enabled: true },
            { type: 'peaking', freq: 700, gainDb: 0, q: 1.4, enabled: true }, // no-op → skipped
            { type: 'highpass', freq: 30, gainDb: 0, q: 0.7, enabled: true },
          ],
        },
        comp: { enabled: true, thresholdDb: -18, ratio: 3, makeupDb: 2 },
        ms: { enabled: true, width: 1.15, monoMakerHz: 120 },
        trim: { enabled: true, gainDb: -1 },
      },
      masterBypass: false,
    });
    expect(moves).toEqual([
      'cut 2.1 dB @ 120 Hz',
      'boost 1.5 dB @ 10 kHz (high shelf)',
      'high-pass @ 30 Hz',
      'comp 3:1 @ -18 dB, makeup 2 dB',
      'width 115%',
      'mono below 120 Hz',
      'trim -1 dB',
    ]);
  });

  it('skips disabled modules and pitch entirely', () => {
    const moves = chainToMoves({
      order: ['comp', 'trim'],
      modules: {
        comp: { enabled: false, thresholdDb: -18, ratio: 6 },
        trim: { enabled: true, gainDb: 0 }, // enabled but no-op gain → no move
        pitch: { enabled: true, semitones: 12 },
      },
      masterBypass: false,
    });
    expect(moves).toEqual([]);
  });

  it('emits a generic "on" move for creative modules and orders drift ids last', () => {
    const moves = chainToMoves({
      order: ['reverb'],
      modules: {
        reverb: { enabled: true, mix: 0.3 },
        delay: { enabled: true, mix: 0.2 }, // moduled but unordered → appended
      },
      masterBypass: false,
    });
    expect(moves).toEqual(['Reverb on', 'Delay on']);
  });

  it('returns [] for malformed chains', () => {
    expect(chainToMoves(null)).toEqual([]);
    expect(chainToMoves('chain')).toEqual([]);
    expect(chainToMoves({})).toEqual([]);
    expect(chainToMoves({ modules: 'nope' })).toEqual([]);
    expect(chainToMoves({ modules: { eq: 'nope' } })).toEqual([]);
  });
});

describe('canActOnSuggestion', () => {
  it('lets the owner act only while open', () => {
    expect(canActOnSuggestion('proposed', true)).toBe(true);
    expect(canActOnSuggestion('auditioned', true)).toBe(true);
    expect(canActOnSuggestion('accepted', true)).toBe(false);
    expect(canActOnSuggestion('rejected', true)).toBe(false);
  });
  it('never lets a non-owner act', () => {
    expect(canActOnSuggestion('proposed', false)).toBe(false);
  });
});
