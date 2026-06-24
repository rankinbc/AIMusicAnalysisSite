import { describe, expect, it } from 'vitest';
import { msGains } from './msMatrix';

describe('msGains', () => {
  it('is identity at width 1 (passthrough)', () => {
    expect(msGains(1)).toEqual({ midL: 1, midR: 0, sideL: 0, sideR: 1 });
  });
  it('collapses to mono at width 0 (all 0.5)', () => {
    expect(msGains(0)).toEqual({ midL: 0.5, midR: 0.5, sideL: 0.5, sideR: 0.5 });
  });
  it('exaggerates at width 2', () => {
    expect(msGains(2)).toEqual({ midL: 1.5, midR: -0.5, sideL: -0.5, sideR: 1.5 });
  });
  it('mid gain scales the mid coefficients', () => {
    // midGain 2 at width 1: a = 0.5(2+1) = 1.5, b = 0.5(2-1) = 0.5
    expect(msGains(1, 2, 1)).toEqual({ midL: 1.5, midR: 0.5, sideL: 0.5, sideR: 1.5 });
  });
  it('side gain scales the side like width does (sideGain*width)', () => {
    // sideGain 2 at width 1 equals sideGain 1 at width 2
    expect(msGains(1, 1, 2)).toEqual(msGains(2, 1, 1));
  });
});
