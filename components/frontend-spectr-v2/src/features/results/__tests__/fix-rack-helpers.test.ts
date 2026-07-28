import { describe, expect, it } from 'vitest';

import { enabledModuleIds, readFixChain } from '../fix-rack-helpers';

describe('readFixChain', () => {
  it('narrows a valid chain', () => {
    const c = readFixChain({ order: ['eq', 'limiter'], modules: { eq: { enabled: true } }, masterBypass: false });
    expect(c).not.toBeNull();
    expect(c!.order).toEqual(['eq', 'limiter']);
  });

  it('rejects malformed input', () => {
    expect(readFixChain(null)).toBeNull();
    expect(readFixChain({})).toBeNull();
    expect(readFixChain({ order: 'nope', modules: {} })).toBeNull();
    expect(readFixChain('x')).toBeNull();
  });

  it('drops non-string order entries', () => {
    const c = readFixChain({ order: ['eq', 2, null], modules: {} });
    expect(c!.order).toEqual(['eq']);
  });
});

describe('enabledModuleIds', () => {
  it('returns only enabled modules, in order', () => {
    const chain = {
      order: ['eq', 'comp', 'limiter'],
      modules: { eq: { enabled: true }, comp: { enabled: false }, limiter: { enabled: true } },
    };
    expect(enabledModuleIds(chain)).toEqual(['eq', 'limiter']);
  });

  it('is empty for a clean (no-module) chain', () => {
    expect(enabledModuleIds({ order: ['eq'], modules: {} })).toEqual([]);
    expect(enabledModuleIds(null)).toEqual([]);
  });
});
