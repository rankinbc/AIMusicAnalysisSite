import { describe, expect, it } from 'vitest';
import { stepGate, type GateParams, type GateRtState } from './gateMath';

// Instant attack/release so a single step reaches the target — keeps the
// state-machine assertions deterministic.
const P: GateParams = {
  thresholdLin: 0.1,
  floorLin: 0,
  attackCoef: 1,
  releaseCoef: 1,
  holdSamples: 3,
};

describe('stepGate', () => {
  it('opens to unity when the signal is above threshold', () => {
    const s = stepGate({ env: 0, gain: 0, hold: 0 }, 1, P);
    expect(s.gain).toBeCloseTo(1, 6);
    expect(s.hold).toBe(3);
  });

  it('detector release is slow: a brief dip does not drop env below threshold', () => {
    let s = stepGate({ env: 0, gain: 0, hold: 0 }, 1, P); // env -> 1
    s = stepGate(s, 0, P); // env = 0 + (1 - 0) * 0.999 = 0.999, still above threshold
    expect(s.env).toBeCloseTo(0.999, 3);
    expect(s.gain).toBeCloseTo(1, 6); // env above threshold keeps the gate open
  });

  it('holds for holdSamples after env falls below threshold, then closes to floor', () => {
    // env already below threshold, gate open, hold counting.
    let s: GateRtState = { env: 0.05, gain: 1, hold: 3 };
    s = stepGate(s, 0, P); // hold 3 -> 2, target 1
    expect(s.gain).toBeCloseTo(1, 6);
    s = stepGate(s, 0, P); // hold 2 -> 1
    s = stepGate(s, 0, P); // hold 1 -> 0, target still 1 this step
    s = stepGate(s, 0, P); // hold exhausted -> target floor -> gain closes
    expect(s.gain).toBeCloseTo(0, 6);
  });

  it('keeps gain within [floor, 1]', () => {
    const floored: GateParams = { ...P, floorLin: 0.2 };
    let s: GateRtState = { env: 0, gain: 0.5, hold: 0 };
    for (let i = 0; i < 50; i += 1) s = stepGate(s, 0, floored);
    expect(s.gain).toBeGreaterThanOrEqual(0.2 - 1e-6);
    expect(s.gain).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('release is gradual when releaseCoef < 1', () => {
    const slow: GateParams = { ...P, releaseCoef: 0.1, holdSamples: 0 };
    let s: GateRtState = { env: 0, gain: 1, hold: 0 }; // env 0 < thr, hold 0 -> target floor
    s = stepGate(s, 0, slow); // one gradual release step
    expect(s.gain).toBeGreaterThan(0.5);
    expect(s.gain).toBeLessThan(1);
  });
});
