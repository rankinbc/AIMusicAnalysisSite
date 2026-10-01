// Task P8 — the Listen page's background "light show" canvas: never on a
// phone (the page shows a desktop-only card there), one static frame under
// reduced motion, animated on desktop.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LightShow } from '../LightShow';

const spies = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
const ctx = new Proxy({}, {
  get: (_t, p) => {
    if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (!spies.has(p)) spies.set(p, vi.fn());
    return spies.get(p);
  },
  set: () => true,
});
const raf = vi.fn(() => 1);
function media(map: Record<string, boolean>) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: map[q] ?? false, media: q, addEventListener() {}, removeEventListener() {},
  }));
}
const DESKTOP = '(min-width: 1024px)';
const REDUCE = '(prefers-reduced-motion: reduce)';

describe('LightShow', () => {
  beforeEach(() => {
    raf.mockClear();
    spies.clear();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('below 1024px it mounts nothing and arms no animation loop', () => {
    media({ [DESKTOP]: false });
    const { container } = render(<LightShow playing show />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it('on desktop it animates — also while paused (the dimmed idle state is the design)', () => {
    media({ [DESKTOP]: true });
    const { container } = render(<LightShow playing={false} show />);
    expect(container.querySelector('canvas.lr-bgfx')).not.toBeNull();
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('under reduced motion it paints one static frame and never re-arms', () => {
    media({ [DESKTOP]: true, [REDUCE]: true });
    const { container } = render(<LightShow playing show />);
    expect(container.querySelector('canvas.lr-bgfx')).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
    expect(spies.get('clearRect')).toHaveBeenCalledTimes(1); // exactly one frame was painted
  });

  it('show=false still wins', () => {
    media({ [DESKTOP]: true });
    const { container } = render(<LightShow playing show={false} />);
    expect(container.querySelector('canvas')).toBeNull();
  });
});
