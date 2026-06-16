import { describe, expect, it } from 'vitest';
import { createDropDetector } from './dropDetector';

// Drive a detector through a sequence of (energy, dtMs) steps and collect every
// frame a drop fires at.
function run(
  det: ReturnType<typeof createDropDetector>,
  steps: Array<[energy: number, frames: number]>,
): number {
  let t = 0;
  let drops = 0;
  for (const [energy, frames] of steps) {
    for (let i = 0; i < frames; i += 1) {
      t += 16;
      if (det.push(energy, t).drop) drops += 1;
    }
  }
  return drops;
}

describe('createDropDetector', () => {
  it('expected use: fires once on collapse-then-slam', () => {
    const det = createDropDetector();
    const drops = run(det, [
      [0.6, 60], // loud — establishes the peak
      [0.1, 60], // breakdown — arms
      [0.6, 60], // slam back — drop!
    ]);
    expect(drops).toBe(1);
  });

  it('edge: a steady loud section never drops (no collapse first)', () => {
    const det = createDropDetector();
    const drops = run(det, [[0.6, 300]]);
    expect(drops).toBe(0);
  });

  it('edge: refractory prevents a second drop fired immediately after', () => {
    const det = createDropDetector({ refractoryMs: 4000 });
    let t = 0;
    const feed = (energy: number, frames: number) => {
      let d = 0;
      for (let i = 0; i < frames; i += 1) {
        t += 16;
        if (det.push(energy, t).drop) d += 1;
      }
      return d;
    };
    feed(0.6, 60);
    feed(0.1, 60);
    const first = feed(0.6, 10); // slam → drop
    feed(0.1, 30); // brief dip
    const second = feed(0.6, 10); // slam again, still within refractory
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('silence never arms or drops', () => {
    const det = createDropDetector();
    expect(run(det, [[0.005, 600]])).toBe(0);
  });
});
