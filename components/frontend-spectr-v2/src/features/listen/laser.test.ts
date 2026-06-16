import { describe, it, expect } from 'vitest';
import { laserVars } from './laser';

describe('laserVars', () => {
  it('at 70% matches the prototype defaults', () => {
    const v = laserVars(70);
    expect(v['--laser-i']).toBeCloseTo(0.554, 2);
    expect(v['--laser-w']).toBe('11.1px');
    expect(v['--laser-glow']).toBe('12.7px');
    expect(v['--laser-boost']).toBe('1.00');
    expect(v['--laser-sat']).toBe('1.00');
  });

  it('caps opacity at 1 and escalates boost/sat above 100%', () => {
    const v = laserVars(400);
    expect(v['--laser-i']).toBe(1);
    expect(v['--laser-boost']).toBe('3.85');
    expect(v['--laser-sat']).toBe('2.35');
  });

  it('clamps input to 0..400', () => {
    expect(laserVars(-50)['--laser-i']).toBeCloseTo(0.12, 2);
    expect(laserVars(99999)['--laser-boost']).toBe('3.85');
  });
});
