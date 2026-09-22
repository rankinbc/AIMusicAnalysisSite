// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { usePageMeta } from '../usePageMeta';

const meta = (sel: string) => document.head.querySelector<HTMLMetaElement>(sel)?.content ?? null;
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
});

describe('usePageMeta', () => {
  it('sets canonical, og:url and the twitter pair for a public path', () => {
    renderHook(() => usePageMeta('T — SPECTR', 'D', { path: '/trust/privacy' }));
    expect(canonical()).toBe(`${window.location.origin}/trust/privacy`);
    expect(meta('meta[property="og:url"]')).toBe(`${window.location.origin}/trust/privacy`);
    expect(meta('meta[name="twitter:title"]')).toBe('T — SPECTR');
    expect(meta('meta[name="twitter:description"]')).toBe('D');
  });

  it('adds robots noindex only when asked, and no canonical without a path', () => {
    renderHook(() => usePageMeta('Page not found — SPECTR', undefined, { noindex: true }));
    expect(meta('meta[name="robots"]')).toBe('noindex');
    expect(canonical()).toBeNull();
  });

  it('restores what it found and removes what it created on unmount', () => {
    document.head.innerHTML = '<meta name="description" content="base"><link rel="canonical" href="https://x.test/base">';
    const { unmount } = renderHook(() => usePageMeta('T', 'D', { path: '/a', noindex: true }));
    unmount();
    expect(meta('meta[name="description"]')).toBe('base');
    expect(canonical()).toBe('https://x.test/base');
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
  });
});
