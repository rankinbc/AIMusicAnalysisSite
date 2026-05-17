import { describe, expect, it } from 'vitest';

import {
  PLATFORM_TARGETS,
  TRUE_PEAK_CEILING_DB,
  evaluateClipping,
  evaluateLufs,
  evaluateTruePeak,
  verdictColor,
} from '../helpers/streaming';

describe('evaluateLufs', () => {
  it('returns "unknown" for nullish input', () => {
    expect(evaluateLufs(undefined, -14)).toBe('unknown');
    expect(evaluateLufs(null, -14)).toBe('unknown');
    expect(evaluateLufs(NaN, -14)).toBe('unknown');
  });

  it('returns "pass" within 1 LU of target', () => {
    expect(evaluateLufs(-14, -14)).toBe('pass');
    expect(evaluateLufs(-13.5, -14)).toBe('pass');
    expect(evaluateLufs(-15.0, -14)).toBe('pass');
  });

  it('returns "warn" within 2 LU of target', () => {
    expect(evaluateLufs(-12.5, -14)).toBe('warn');
    expect(evaluateLufs(-15.5, -14)).toBe('warn');
  });

  it('returns "fail" beyond 2 LU of target', () => {
    expect(evaluateLufs(-8, -14)).toBe('fail');
    expect(evaluateLufs(-20, -14)).toBe('fail');
  });
});

describe('evaluateTruePeak', () => {
  it('passes at or below ceiling', () => {
    expect(evaluateTruePeak(-2.0)).toBe('pass');
    expect(evaluateTruePeak(TRUE_PEAK_CEILING_DB)).toBe('pass');
  });

  it('fails above ceiling', () => {
    expect(evaluateTruePeak(-0.5)).toBe('fail');
    expect(evaluateTruePeak(0.0)).toBe('fail');
  });

  it('returns "unknown" for nullish input', () => {
    expect(evaluateTruePeak(undefined)).toBe('unknown');
    expect(evaluateTruePeak(null)).toBe('unknown');
  });
});

describe('evaluateClipping', () => {
  it('passes when clipping is explicitly false', () => {
    expect(evaluateClipping(false)).toBe('pass');
  });

  it('fails when clipping is true', () => {
    expect(evaluateClipping(true)).toBe('fail');
  });

  it('returns "unknown" for nullish input', () => {
    expect(evaluateClipping(undefined)).toBe('unknown');
    expect(evaluateClipping(null)).toBe('unknown');
  });
});

describe('verdictColor', () => {
  it('maps each verdict to a CSS variable', () => {
    expect(verdictColor('pass')).toBe('var(--sev-ok)');
    expect(verdictColor('warn')).toBe('var(--sev-warn)');
    expect(verdictColor('fail')).toBe('var(--sev-fail)');
    expect(verdictColor('unknown')).toBe('var(--sev-unknown)');
  });
});

describe('PLATFORM_TARGETS', () => {
  it('includes the 7 platforms from CLAUDE.md', () => {
    const names = PLATFORM_TARGETS.map((p) => p.name);
    expect(names).toEqual([
      'Spotify',
      'Apple Music',
      'YouTube',
      'Tidal',
      'Amazon Music',
      'SoundCloud',
      'Beatport',
    ]);
  });
});
