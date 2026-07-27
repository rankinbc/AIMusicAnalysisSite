// Regression: dragging a band dot must always edit the band — including while
// the module is disabled/bypassed (`dim`); a gate on `dim` once made the dots
// silently dead whenever the EQ toggle or master BYPASS was engaged.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EqBand } from '../data';
import { EqCurveEditor } from '../EqCurveEditor';

afterEach(cleanup);

const BANDS: EqBand[] = [
  { type: 'peaking', freq: 60, gainDb: -2, q: 1.4, enabled: true },
  { type: 'peaking', freq: 1000, gainDb: 0, q: 1.4, enabled: true },
];

function mount(dim: boolean) {
  const onBands = vi.fn();
  const utils = render(
    <EqCurveEditor bands={BANDS} accent="var(--cyan)" dim={dim} onBands={onBands} />,
  );
  const svg = utils.container.querySelector('svg') as SVGSVGElement;
  // jsdom has no layout — give the SVG a real box so pointer math resolves.
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 460, height: 168, right: 460, bottom: 168, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const dots = utils.container.querySelectorAll('g.bd');
  return { onBands, svg, dots, ...utils };
}

function drag(dot: Element, to: { x: number; y: number }) {
  fireEvent.pointerDown(dot, { clientX: 10, clientY: 84 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window);
}

describe('EqCurveEditor dot drag', () => {
  it('drag moves the band (freq + gain) via onBands', () => {
    const { onBands, dots } = mount(false);
    drag(dots[0], { x: 230, y: 42 }); // mid-x ≈ 632 Hz, upper quarter ≈ +7.5 dB
    expect(onBands).toHaveBeenCalled();
    const next = onBands.mock.calls.at(-1)?.[0] as EqBand[];
    expect(next[0].freq).toBeGreaterThan(400);
    expect(next[0].freq).toBeLessThan(900);
    expect(next[0].gainDb).toBeGreaterThan(3);
    expect(next[1]).toEqual(BANDS[1]); // other bands untouched
  });

  it('drag still works while the module is disabled (dim)', () => {
    const { onBands, dots } = mount(true);
    drag(dots[0], { x: 230, y: 42 });
    expect(onBands).toHaveBeenCalled();
  });

  it('drag on a highpass dot changes cutoff only', () => {
    const onBands = vi.fn();
    const bands: EqBand[] = [{ type: 'highpass', freq: 30, gainDb: 0, q: 0.7, enabled: true }];
    const utils = render(
      <EqCurveEditor bands={bands} accent="var(--cyan)" dim={false} onBands={onBands} />,
    );
    const svg = utils.container.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 460, height: 168, right: 460, bottom: 168, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    drag(utils.container.querySelector('g.bd') as Element, { x: 120, y: 20 });
    const next = onBands.mock.calls.at(-1)?.[0] as EqBand[];
    expect(next[0].freq).toBeGreaterThan(30);
    expect(next[0].gainDb).toBe(0); // filters never take gain from the drag
  });
});
