import { describe, expect, it } from 'vitest';

import type { StemRole } from '../../api/types';
import { buildAutoConfirmPayload, decideDispatchPath } from '../unified-upload-helpers';

describe('decideDispatchPath', () => {
  it('routes to the stems confirm dispatch when stems are present', () => {
    expect(decideDispatchPath({ hasStems: true })).toBe('stems');
  });

  it('routes to /analyze when there are no stems', () => {
    expect(decideDispatchPath({ hasStems: false })).toBe('analyze');
  });
});

describe('buildAutoConfirmPayload', () => {
  it('maps id + detectedRole for each stem', () => {
    const out = buildAutoConfirmPayload([
      { id: 'a', detectedRole: 'kick' as StemRole },
      { id: 'b', detectedRole: 'bass' as StemRole },
    ]);
    expect(out).toEqual([
      { id: 'a', confirmedRole: 'kick' },
      { id: 'b', confirmedRole: 'bass' },
    ]);
  });

  it("falls back to 'other' when the classifier returned no role", () => {
    expect(buildAutoConfirmPayload([{ id: 'a', detectedRole: null }])).toEqual([
      { id: 'a', confirmedRole: 'other' },
    ]);
  });

  it('returns empty for no stems', () => {
    expect(buildAutoConfirmPayload([])).toEqual([]);
  });
});
