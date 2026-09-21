import { afterEach, describe, expect, it, vi } from 'vitest';
const S = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), setTag: vi.fn() }));
vi.mock('@sentry/react', () => ({
  init: S.init, captureException: S.captureException, getCurrentScope: () => ({ setTag: S.setTag }),
}));
async function load(dsn: string) {
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', dsn);
  return import('../sentry');
}
afterEach(() => { vi.unstubAllEnvs(); for (const f of Object.values(S)) f.mockReset(); });
describe('sentry — loaded only with a DSN, errors buffered until it arrives', () => {
  it('without a DSN it is fully inert', async () => {
    const s = await load('');
    s.initSentry(); s.reportError(new Error('x')); s.setCorrelation('j1');
    await vi.dynamicImportSettled();
    expect(S.init).not.toHaveBeenCalled();
    expect(S.captureException).not.toHaveBeenCalled();
  });
  it('flushes at most 20 buffered errors and the last correlation id on load', async () => {
    const s = await load('https://k@o.ingest/1');
    s.initSentry();
    for (let i = 0; i < 25; i++) s.reportError(new Error(`e${i}`));
    s.setCorrelation('job-9');
    await vi.dynamicImportSettled();
    expect(S.init).toHaveBeenCalledTimes(1);
    expect(S.captureException).toHaveBeenCalledTimes(20);
    expect(S.setTag).toHaveBeenCalledWith('correlation_id', 'job-9');
    s.reportError(new Error('late'));
    expect(S.captureException).toHaveBeenCalledTimes(21);
  });
});
