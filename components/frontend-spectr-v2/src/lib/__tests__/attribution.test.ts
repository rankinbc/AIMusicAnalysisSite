// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ATTRIBUTION_KEY as KEY,
  attributionPayload,
  captureAttribution,
  getAttribution,
  sanitizeSource,
} from '../attribution';

function setUrl(pathAndQuery: string) {
  window.history.replaceState({}, '', pathAndQuery);
}

function setReferrer(value: string) {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}

describe('first-touch attribution (F1)', () => {
  afterEach(() => {
    window.localStorage.clear();
    setUrl('/');
    setReferrer('');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns {} with no params, no referrer and no stash — and stores nothing', () => {
    captureAttribution();
    expect(getAttribution()).toEqual({});
    expect(attributionPayload()).toEqual({});
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('captures utm_source / utm_medium / utm_campaign and leaves utm params in the URL', () => {
    setUrl('/?utm_source=YouTube&utm_medium=video&utm_campaign=launch_oct');
    captureAttribution();
    expect(getAttribution()).toEqual({ source: 'youtube', medium: 'video', campaign: 'launch_oct' });
    expect(window.location.search).toContain('utm_source=YouTube');
    expect(attributionPayload()).toEqual({
      attribution: { source: 'youtube', medium: 'video', campaign: 'launch_oct' },
    });
  });

  it('falls back utm_source → via → ref, and an empty param never shadows the next', () => {
    setUrl('/?utm_source=&via=&ref=producthunt');
    captureAttribution();
    expect(getAttribution()).toEqual({ source: 'producthunt' });
  });

  it('is a non-draining read: the same source is returned every time', () => {
    setUrl('/?via=newsletter');
    captureAttribution();
    expect(getAttribution()).toEqual({ source: 'newsletter' });
    expect(getAttribution()).toEqual({ source: 'newsletter' });
  });

  it('first touch wins: a later visit with a different source does not overwrite', () => {
    setUrl('/?utm_source=first');
    captureAttribution();
    setUrl('/pricing?utm_source=second&utm_campaign=late');
    captureAttribution();
    expect(getAttribution()).toEqual({ source: 'first' });
  });

  it('an expired stash (30 days) is replaced by the new touch', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    setUrl('/?utm_source=old');
    captureAttribution();
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
    expect(getAttribution()).toEqual({});
    setUrl('/?utm_source=new');
    captureAttribution();
    expect(getAttribution()).toEqual({ source: 'new' });
  });

  it('strips ref/via from the address bar but keeps the path, other params and hash', () => {
    setUrl('/analyze?ref=friend&next=%2Fpricing&via=x#top');
    captureAttribution();
    expect(window.location.pathname).toBe('/analyze');
    expect(window.location.search).toBe('?next=%2Fpricing');
    expect(window.location.hash).toBe('#top');
  });

  it('strips ref/via even when an earlier touch already holds the stash', () => {
    setUrl('/?utm_source=first');
    captureAttribution();
    setUrl('/?ref=' + encodeURIComponent('jane@x.com'));
    captureAttribution();
    expect(window.location.search).toBe('');
    expect(getAttribution()).toEqual({ source: 'first' });
  });

  it('slugifies an email-like ref — no @ or dot survives, in storage or the URL (privacy)', () => {
    setUrl('/?ref=' + encodeURIComponent('jane.doe@gmail.com'));
    captureAttribution();
    expect(getAttribution()).toEqual({ source: 'janedoegmailcom' });
    expect(window.localStorage.getItem(KEY)).not.toContain('@');
    expect(window.location.href).not.toContain('jane');
  });

  it('drops a value with nothing slug-shaped in it', () => {
    setUrl('/?ref=' + encodeURIComponent('!!!'));
    captureAttribution();
    expect(getAttribution()).toEqual({});
  });

  it('caps a slug at 64 characters', () => {
    expect(sanitizeSource('a'.repeat(200))).toHaveLength(64);
  });

  it('keeps only the HOST of an external referrer', () => {
    setReferrer('https://www.Google.com/search?q=secret+terms');
    captureAttribution();
    expect(getAttribution()).toEqual({ referrer: 'www.google.com' });
    expect(window.localStorage.getItem(KEY)).not.toContain('secret');
  });

  it('ignores a same-site referrer', () => {
    setReferrer(`${window.location.origin}/pricing`);
    captureAttribution();
    expect(getAttribution()).toEqual({});
  });

  it('treats the pre-F1 bare-string stash and malformed JSON as empty', () => {
    window.localStorage.setItem(KEY, 'newsletter');
    expect(getAttribution()).toEqual({});
    window.localStorage.setItem(KEY, '{"source":');
    expect(getAttribution()).toEqual({});
    window.localStorage.setItem(KEY, JSON.stringify({ source: 'no-timestamp' }));
    expect(getAttribution()).toEqual({});
  });

  it('re-sanitizes a tampered stash on read', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ source: 'Jane@X.com', referrer: 'evil.com/path?x=1', at: Date.now() }),
    );
    expect(getAttribution()).toEqual({ source: 'janexcom' });
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setUrl('/?utm_source=x');
    expect(() => captureAttribution()).not.toThrow();
    expect(getAttribution()).toEqual({});
  });
});
