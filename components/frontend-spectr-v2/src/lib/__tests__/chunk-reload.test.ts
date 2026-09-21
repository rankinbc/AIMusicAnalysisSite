import { describe, expect, it, vi } from 'vitest';
import { installChunkReloadListener, isStaleChunkError, reloadOnceForStaleChunk } from '../chunk-reload';
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
describe('chunk-reload', () => {
  it('recognises the dynamic-import failures browsers actually throw', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError('nope')).toBe(false);
  });
  it('reloads once, refuses inside the five-minute window, allows again after it', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ now: 1_000, storage, reload })).toBe(true);
    expect(reloadOnceForStaleChunk({ now: 1_000 + 299_000, storage, reload })).toBe(false);
    expect(reloadOnceForStaleChunk({ now: 1_000 + 300_001, storage, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('never reloads when storage is unavailable (no guard = possible loop)', () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ now: 1, storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('the vite:preloadError listener swallows the event only when it reloaded', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const off = installChunkReloadListener({ target, storage: fakeStorage(), reload, now: () => 5 });
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false); // surfaces → RouteErrorScreen
    off();
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
