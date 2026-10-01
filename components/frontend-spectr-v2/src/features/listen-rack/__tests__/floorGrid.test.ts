// The shared floor grid (LightShow + the analysis page's listening backdrop).
import { describe, expect, it, vi } from 'vitest';

import { drawFloorGrid } from '../floorGrid';

function fakeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    globalCompositeOperation: 'source-over', shadowColor: '', shadowBlur: 0, lineWidth: 1, strokeStyle: '',
  };
}

describe('drawFloorGrid', () => {
  it('draws the nine scrolling lines in the lower third, additively', () => {
    const ctx = fakeCtx();
    drawFloorGrid(ctx as unknown as CanvasRenderingContext2D, 1000, 600, 3.2, { hue: 200, gridIntensity: 50, intensity: 1, live: 1 });
    expect(ctx.stroke).toHaveBeenCalledTimes(9);
    for (const [, y] of ctx.moveTo.mock.calls as [number, number][]) {
      expect(y).toBeGreaterThanOrEqual(600 * 0.66);
      expect(y).toBeLessThanOrEqual(600);
    }
    expect(ctx.strokeStyle).toContain('hsla(200,');
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('draws nothing when the grid is turned off', () => {
    const ctx = fakeCtx();
    drawFloorGrid(ctx as unknown as CanvasRenderingContext2D, 1000, 600, 0, { gridIntensity: 0, intensity: 1, live: 1 });
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });
});
