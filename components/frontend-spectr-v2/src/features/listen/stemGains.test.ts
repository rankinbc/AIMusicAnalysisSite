import { describe, it, expect } from 'vitest';
import { computeStemGains, type StemControl } from './stemGains';

const base: StemControl[] = [
  { id: 'a', volume: 0.8, mute: false, solo: false },
  { id: 'b', volume: 0.6, mute: false, solo: false },
  { id: 'c', volume: 1.0, mute: false, solo: false },
];

describe('computeStemGains', () => {
  it('passes volume through when nothing muted or soloed', () => {
    expect(computeStemGains(base)).toEqual({ a: 0.8, b: 0.6, c: 1.0 });
  });

  it('zeroes a muted stem', () => {
    const g = computeStemGains([{ ...base[0], mute: true }, base[1], base[2]]);
    expect(g.a).toBe(0);
    expect(g.b).toBe(0.6);
  });

  it('solo silences all non-soloed stems', () => {
    const g = computeStemGains([{ ...base[0], solo: true }, base[1], base[2]]);
    expect(g.a).toBe(0.8);
    expect(g.b).toBe(0);
    expect(g.c).toBe(0);
  });

  it('muted-and-soloed stem stays silent (mute wins)', () => {
    const g = computeStemGains([{ ...base[0], solo: true, mute: true }, base[1], base[2]]);
    expect(g.a).toBe(0);
  });

  it('multiple solos all play, others silent', () => {
    const g = computeStemGains([
      { ...base[0], solo: true },
      { ...base[1], solo: true },
      base[2],
    ]);
    expect(g.a).toBe(0.8);
    expect(g.b).toBe(0.6);
    expect(g.c).toBe(0);
  });

  it('keys output by stem id, so duplicate roles do not collide', () => {
    const twoOther: StemControl[] = [
      { id: 'x1', volume: 0.5, mute: false, solo: false },
      { id: 'x2', volume: 0.9, mute: true, solo: false },
    ];
    expect(computeStemGains(twoOther)).toEqual({ x1: 0.5, x2: 0 });
  });
});
