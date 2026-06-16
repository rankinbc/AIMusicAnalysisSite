import { describe, expect, it } from 'vitest';
import { createBeatDetector } from './beatDetector';

// Build an 8-element band array with a given low-band energy.
function bands(low: number): number[] {
  return [low, low, low, 0, 0, 0, 0, 0];
}

describe('createBeatDetector', () => {
  it('expected use: fires a beat when low-band energy spikes above the rolling average', () => {
    const det = createBeatDetector();
    // Warm up the rolling average with quiet frames.
    let t = 0;
    for (let i = 0; i < 30; i += 1, t += 16) det.push(bands(0.05), t);

    // A loud frame well above the average should trigger.
    const spike = det.push(bands(0.6), (t += 16));
    expect(spike.beat).toBe(true);
    expect(spike.energy).toBeGreaterThan(0);
  });

  it('edge: refractory window suppresses a second beat fired too soon', () => {
    const det = createBeatDetector({ refractoryMs: 300 });
    let t = 0;
    for (let i = 0; i < 30; i += 1, t += 16) det.push(bands(0.05), t);

    const first = det.push(bands(0.6), (t += 16));
    expect(first.beat).toBe(true);
    // Another spike only 100ms later — inside the refractory window.
    const second = det.push(bands(0.6), (t += 100));
    expect(second.beat).toBe(false);
    // After the refractory window clears, a spike triggers again.
    const third = det.push(bands(0.6), (t += 300));
    expect(third.beat).toBe(true);
  });

  it('failure/silence: near-silent frames never trigger a beat', () => {
    const det = createBeatDetector();
    let t = 0;
    let anyBeat = false;
    for (let i = 0; i < 120; i += 1, t += 16) {
      if (det.push(bands(0.001), t).beat) anyBeat = true;
    }
    expect(anyBeat).toBe(false);
  });

  it('reset clears rolling state', () => {
    const det = createBeatDetector();
    let t = 0;
    for (let i = 0; i < 30; i += 1, t += 16) det.push(bands(0.5), t);
    det.reset();
    // First frame after reset has a zero average, so even a modest energy
    // reads as a spike — confirms state was actually cleared.
    expect(det.push(bands(0.5), (t += 16)).beat).toBe(true);
  });
});
