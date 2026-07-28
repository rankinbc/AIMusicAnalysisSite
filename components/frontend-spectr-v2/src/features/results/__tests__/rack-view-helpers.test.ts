import { describe, expect, it } from 'vitest';

import { signalFlowNodes } from '../rack-view-helpers';

describe('signalFlowNodes', () => {
  it('resolves enabled modules in signal order with manifest metadata', () => {
    const chain = {
      order: ['eq', 'comp', 'limiter'],
      modules: { eq: { enabled: true }, comp: { enabled: false }, limiter: { enabled: true } },
    };
    const nodes = signalFlowNodes(chain);
    expect(nodes.map((n) => n.id)).toEqual(['eq', 'limiter']);
    // every node carries a label/glyph/accent (from RACK_MANIFEST, non-empty)
    for (const n of nodes) {
      expect(n.label).toBeTruthy();
      expect(n.glyph).toBeTruthy();
      expect(n.accent).toBeTruthy();
    }
  });

  it('edge: an unknown module id still yields a node with fallbacks', () => {
    const nodes = signalFlowNodes({ order: ['not_a_real_module'], modules: { not_a_real_module: { enabled: true } } });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe('not_a_real_module');
    expect(nodes[0].glyph).toBe('·');
  });

  it('failure: malformed/empty chain returns []', () => {
    expect(signalFlowNodes(null)).toEqual([]);
    expect(signalFlowNodes({})).toEqual([]);
    expect(signalFlowNodes({ order: ['eq'], modules: {} })).toEqual([]);
  });
});
