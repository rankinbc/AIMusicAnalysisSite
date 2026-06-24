import { describe, expect, it } from 'vitest';
import { bpmSyncHz, bpmSyncSeconds } from './bpmSync';

describe('bpmSyncSeconds', () => {
  it('maps note divisions to seconds at 120 BPM (0.5 s per beat)', () => {
    expect(bpmSyncSeconds('1/4', 120)).toBeCloseTo(0.5, 6);
    expect(bpmSyncSeconds('1/8', 120)).toBeCloseTo(0.25, 6);
    expect(bpmSyncSeconds('1/8.', 120)).toBeCloseTo(0.375, 6); // dotted = 1.5x eighth
    expect(bpmSyncSeconds('1/8T', 120)).toBeCloseTo(1 / 6, 6); // triplet = 2/3 eighth
    expect(bpmSyncSeconds('1/16', 120)).toBeCloseTo(0.125, 6);
  });

  it('scales inversely with BPM', () => {
    expect(bpmSyncSeconds('1/4', 60)).toBeCloseTo(1.0, 6);
    expect(bpmSyncSeconds('1/4', 240)).toBeCloseTo(0.25, 6);
  });
});

describe('bpmSyncHz', () => {
  it('is the reciprocal of the synced period', () => {
    expect(bpmSyncHz('1/8', 120)).toBeCloseTo(4, 6); // 1 / 0.25 s
    expect(bpmSyncHz('1/4', 120)).toBeCloseTo(2, 6);
  });
});
