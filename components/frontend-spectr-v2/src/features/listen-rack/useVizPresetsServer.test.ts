import { describe, expect, it } from 'vitest';

import { asVizLook } from './useVizPresetsServer';

describe('asVizLook', () => {
  it('accepts a well-shaped look', () => {
    const look = asVizLook({ viz: { barColor: '#fff' }, stages: ['eq', 'orbit'], director: 'pulse' });
    expect(look).not.toBeNull();
    expect(look!.stages).toEqual(['eq', 'orbit']);
    expect(look!.director).toBe('pulse');
  });

  it('defaults stages + director when absent or malformed', () => {
    const look = asVizLook({ viz: {} });
    expect(look!.stages).toEqual([]);
    expect(look!.director).toBe('');
  });

  it('drops non-string stage ids', () => {
    const look = asVizLook({ viz: {}, stages: ['eq', 3, null, 'bloom'] });
    expect(look!.stages).toEqual(['eq', 'bloom']);
  });

  it('returns null without a viz object', () => {
    expect(asVizLook(null)).toBeNull();
    expect(asVizLook({ stages: [] })).toBeNull();
    expect(asVizLook('nope')).toBeNull();
  });
});
