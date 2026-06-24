import type { Division } from '../state';

// Length of each division in quarter-note beats.
const BEATS: Record<Division, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/8.': 0.75, // dotted eighth = 1.5 x eighth
  '1/8T': 1 / 3, // eighth triplet = 2/3 x eighth
  '1/16': 0.25,
};

export function bpmSyncSeconds(division: Division, bpm: number): number {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  return secondsPerBeat * BEATS[division];
}

export function bpmSyncHz(division: Division, bpm: number): number {
  const s = bpmSyncSeconds(division, bpm);
  return s > 0 ? 1 / s : 0;
}
