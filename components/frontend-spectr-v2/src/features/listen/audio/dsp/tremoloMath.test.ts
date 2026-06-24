import { describe, expect, it } from 'vitest';
import { tremoloOffsets } from './tremoloMath';

describe('tremoloOffsets', () => {
  it('tremolo at depth 0 is transparent (unity gain, no modulation)', () => {
    expect(tremoloOffsets('tremolo', 0)).toEqual({ offset: 1, depthTrem: 0, depthPan: 0 });
  });

  it('tremolo gain swings within [1-depth, 1]', () => {
    // offset = 1 - depth/2, AC amplitude = depth/2 => range [1-depth, 1]
    expect(tremoloOffsets('tremolo', 1)).toEqual({ offset: 0.5, depthTrem: 0.5, depthPan: 0 });
  });

  it('autopan modulates pan only (gain held unity)', () => {
    expect(tremoloOffsets('autopan', 1)).toEqual({ offset: 1, depthTrem: 0, depthPan: 1 });
    expect(tremoloOffsets('autopan', 0)).toEqual({ offset: 1, depthTrem: 0, depthPan: 0 });
  });

  it('clamps depth to [0, 1]', () => {
    expect(tremoloOffsets('tremolo', 5)).toEqual(tremoloOffsets('tremolo', 1));
    expect(tremoloOffsets('autopan', -1)).toEqual(tremoloOffsets('autopan', 0));
  });
});
