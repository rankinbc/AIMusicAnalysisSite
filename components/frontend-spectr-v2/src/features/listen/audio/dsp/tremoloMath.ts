import type { TremoloState } from '../state';

// Resolve the DC offset and the two modulation-depth gains for the tremolo unit.
// tremolo: gain = offset +/- depthTrem*LFO => swings in [1-depth, 1].
// autopan: pan  = 0     +/- depthPan*LFO   => swings in [-depth, +depth], gain unity.
export function tremoloOffsets(
  mode: TremoloState['mode'],
  depth: number,
): { offset: number; depthTrem: number; depthPan: number } {
  const d = Math.min(1, Math.max(0, depth));
  if (mode === 'autopan') {
    return { offset: 1, depthTrem: 0, depthPan: d };
  }
  return { offset: 1 - d / 2, depthTrem: d / 2, depthPan: 0 };
}
