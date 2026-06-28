import { describe, expect, it } from 'vitest';

import type { SuggestionDto } from '../../../api/types';
import { canActOnSuggestion, chainSummary, partitionSuggestions } from '../suggestion-helpers';

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
