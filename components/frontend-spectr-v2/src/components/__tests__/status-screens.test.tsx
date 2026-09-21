// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const spies = vi.hoisted(() => ({ reportError: vi.fn(), reloadOnce: vi.fn(() => true) }));
vi.mock('../../lib/sentry', () => ({ reportError: spies.reportError }));
vi.mock('../../lib/chunk-reload', async (orig) => ({
  ...(await orig<typeof import('../../lib/chunk-reload')>()),
  reloadOnceForStaleChunk: spies.reloadOnce,
}));
import { NotFoundScreen } from '../NotFoundScreen';
import { RouteErrorScreen } from '../RouteErrorScreen';
describe('status screens', () => {
  beforeEach(() => { spies.reportError.mockReset(); spies.reloadOnce.mockClear(); });
  afterEach(() => { cleanup(); });
  it('404 keeps the product on screen: chrome, heading, two ways out, its own title', () => {
    render(<NotFoundScreen />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/doesn.t exist/i);
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Analyze a track' }).getAttribute('href')).toBe('/analyze');
    expect(screen.getByText('Analyze free')).toBeTruthy(); // PublicChrome, anon variant
    expect(document.title).toBe('Page not found — SPECTR');
  });
  it('a route error is reported once and offers reload + home', () => {
    const err = new Error('boom');
    render(<RouteErrorScreen error={err} reset={() => {}} />);
    expect(spies.reportError).toHaveBeenCalledTimes(1);
    expect(spies.reportError).toHaveBeenCalledWith(err);
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
  it('a stale-chunk error triggers the guarded reload instead of a report', () => {
    render(<RouteErrorScreen error={new TypeError('Failed to fetch dynamically imported module: /assets/a.js')} reset={() => {}} />);
    expect(spies.reloadOnce).toHaveBeenCalledTimes(1);
    expect(spies.reportError).not.toHaveBeenCalled();
  });
});
