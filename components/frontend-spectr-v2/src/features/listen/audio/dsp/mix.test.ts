import { describe, expect, it } from 'vitest';
import { wetDryGains } from './mix';

describe('wetDryGains', () => {
  it('full wet at 1', () => expect(wetDryGains(1)).toEqual({ dry: 0, wet: 1 }));
  it('full dry (bypass) at 0', () => expect(wetDryGains(0)).toEqual({ dry: 1, wet: 0 }));
  it('50/50 at 0.5', () => expect(wetDryGains(0.5)).toEqual({ dry: 0.5, wet: 0.5 }));
  it('clamps out-of-range input', () => {
    expect(wetDryGains(2)).toEqual({ dry: 0, wet: 1 });
    expect(wetDryGains(-1)).toEqual({ dry: 1, wet: 0 });
  });
});
