import { afterEach, describe, expect, it, vi } from 'vitest';
const ph = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }));
vi.mock('posthog-js', () => ({ default: ph }));
async function load(key: string) {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  return import('../analytics');
}
afterEach(() => { vi.unstubAllEnvs(); for (const f of Object.values(ph)) f.mockReset(); });
describe('analytics — posthog is loaded only when there is a key', () => {
  it('without a key nothing is imported, initialised or captured', async () => {
    const a = await load('');
    a.initAnalytics();
    a.capture('landing_viewed');
    await vi.dynamicImportSettled();
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });
  it('events fired before the SDK arrives are delivered, in order', async () => {
    const a = await load('phc_test');
    a.capture('landing_viewed');
    a.initAnalytics();
    a.capture('pricing_viewed', { x: 1 });
    a.identifyUser('u1');
    expect(ph.capture).not.toHaveBeenCalled(); // still loading
    await vi.dynamicImportSettled();
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.capture.mock.calls).toEqual([['landing_viewed', undefined], ['pricing_viewed', { x: 1 }]]);
    expect(ph.identify).toHaveBeenCalledWith('u1');
    a.capture('resume_shown');
    expect(ph.capture).toHaveBeenCalledTimes(3); // direct once loaded
  });
  it('the queue is bounded and an init failure drops it silently', async () => {
    ph.init.mockImplementation(() => { throw new Error('blocked storage'); });
    const a = await load('phc_test');
    for (let i = 0; i < 80; i++) a.capture('landing_viewed');
    a.initAnalytics();
    await vi.dynamicImportSettled();
    expect(ph.capture).not.toHaveBeenCalled();
    expect(() => a.capture('landing_viewed')).not.toThrow();
  });
});
