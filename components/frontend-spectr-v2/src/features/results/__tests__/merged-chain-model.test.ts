import { describe, expect, it } from 'vitest';

import { buildMergedChain, moduleForOp } from '../merged-chain-model';
import type { Move } from '../move-model';
import type { VerdictDspOp } from '../../../api/types';

const move = (id: string, title: string, ops: VerdictDspOp[], impact = 50): Move =>
  ({
    id,
    title,
    group: 'quick',
    sev: 'warn',
    scope: 'Master bus',
    directive: title,
    directional: title,
    steps: [],
    hasParams: true,
    why: '',
    evidence: { type: 'none', metric: '', chartType: null },
    ops,
    impact,
    confidence: 0.9,
  }) as unknown as Move;

const eq = (freq: number, gain: number): VerdictDspOp => ({
  type: 'peaking_eq',
  params: { frequency_hz: freq, gain_db: gain, q: 1 },
});
const gain = (db: number): VerdictDspOp => ({ type: 'gain', params: { gain_db: db } });

describe('moduleForOp', () => {
  it('maps every eq-family op to the one eq module', () => {
    for (const t of ['peaking_eq', 'high_shelf', 'low_shelf', 'high_pass', 'low_pass']) {
      expect(moduleForOp(t)).toBe('eq');
    }
  });

  it('returns null for ops with no master-rack home', () => {
    expect(moduleForOp('sidechain')).toBeNull();
    expect(moduleForOp('multiband_compressor')).toBeNull();
  });
});

describe('buildMergedChain', () => {
  it('collapses many fixes into few devices and keeps every source attributed', () => {
    const moves = [
      move('m1', 'Tame the sub', [eq(48, -3.5)]),
      move('m2', 'Clear the low-mid mud', [eq(320, -3.8)]),
      move('m3', 'Master is too loud', [gain(-2.5)]),
      move('m4', 'True peak over the ceiling', [gain(-3.7)]),
      move('m5', 'Clipping detected', [gain(-2)]),
    ];
    const chain = buildMergedChain(moves);

    expect(chain.fixCount).toBe(5);
    expect(chain.devices.map((d) => d.moduleId)).toEqual(['eq', 'trim']);

    // Every fix still findable under the device it fed — nothing vanishes.
    const attributed = chain.devices.flatMap((d) => d.sources.map((s) => s.moveId));
    expect(new Set(attributed)).toEqual(new Set(['m1', 'm2', 'm3', 'm4', 'm5']));
  });

  it('shows the binding trim, not the sum of the three level symptoms', () => {
    const chain = buildMergedChain([
      move('m3', 'Master is too loud', [gain(-2.5)]),
      move('m4', 'True peak over the ceiling', [gain(-3.7)]),
      move('m5', 'Clipping detected', [gain(-2)]),
    ]);
    const trim = chain.devices.find((d) => d.moduleId === 'trim');
    expect(trim?.summary).toBe('−3.7 dB');
    expect(trim?.sources).toHaveLength(3);
    expect(chain.decisions.some((d) => d.includes('binding'))).toBe(true);
  });

  it('renders high-pass cutoffs, which carry no gain', () => {
    const chain = buildMergedChain([
      move('m1', 'Rumble below 30 Hz', [{ type: 'high_pass', params: { frequency_hz: 30, q: 0.7 } }]),
    ]);
    expect(chain.devices[0]?.summary).toBe('HP 30 Hz');
  });

  it('does not claim a device whose moves merged out to a no-op', () => {
    // Equal and opposite trims net to 0 — no instruction to give.
    const chain = buildMergedChain([
      move('a', 'Too loud', [gain(-3)], 50),
      move('b', 'Too quiet', [gain(3)], 50),
    ]);
    expect(chain.devices.find((d) => d.moduleId === 'trim')).toBeUndefined();
  });

  it('ignores moves with no rack-mappable ops', () => {
    const chain = buildMergedChain([
      move('sc', 'Sidechain the pad to the kick', [{ type: 'sidechain', params: {} }]),
    ]);
    expect(chain.devices).toHaveLength(0);
    expect(chain.fixCount).toBe(0);
  });
});
