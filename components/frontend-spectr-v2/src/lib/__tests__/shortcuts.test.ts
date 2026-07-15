// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  NAV_COMMANDS,
  filterCommands,
  isEditableTarget,
  matchShortcut,
  type ShortcutKeyEvent,
} from '../shortcuts';

// Story 5.10 (UX-DR43) — the shortcut decision matrix, tested pure.

function ev(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    target: null,
    ...overrides,
  };
}

describe('matchShortcut', () => {
  it('maps ⌘K and Ctrl+K to palette (case-insensitive)', () => {
    expect(matchShortcut(ev({ key: 'k', metaKey: true }))).toBe('palette');
    expect(matchShortcut(ev({ key: 'K', ctrlKey: true }))).toBe('palette');
  });

  it('maps ⌘U / Ctrl+U to upload', () => {
    expect(matchShortcut(ev({ key: 'u', metaKey: true }))).toBe('upload');
    expect(matchShortcut(ev({ key: 'u', ctrlKey: true }))).toBe('upload');
  });

  it('maps plain ? to sheet — but NOT modified ?', () => {
    expect(matchShortcut(ev({ key: '?' }))).toBe('sheet');
    expect(matchShortcut(ev({ key: '?', ctrlKey: true }))).toBeNull();
  });

  it('never hijacks shift chords (Ctrl+Shift+K is the Firefox console)', () => {
    expect(matchShortcut(ev({ key: 'K', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(ev({ key: 'U', metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('falls back to e.code for non-Latin layouts', () => {
    expect(matchShortcut(ev({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe('palette');
    expect(matchShortcut(ev({ key: 'г', code: 'KeyU', metaKey: true }))).toBe('upload');
  });

  it('does not suppress modifier chords on non-text inputs (checkbox/radio/range)', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);
    expect(matchShortcut(ev({ key: 'k', metaKey: true, target: cb }))).toBe('palette');
  });

  it('ignores bare letters, repeats, IME composition, and alt combos', () => {
    expect(matchShortcut(ev({ key: 'k' }))).toBeNull();
    expect(matchShortcut(ev({ key: 'k', metaKey: true, repeat: true }))).toBeNull();
    expect(matchShortcut(ev({ key: 'k', metaKey: true, isComposing: true }))).toBeNull();
    expect(matchShortcut(ev({ key: 'k', metaKey: true, altKey: true }))).toBeNull();
  });

  it('suppresses everything while typing in editable targets', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(matchShortcut(ev({ key: 'k', metaKey: true, target: input }))).toBeNull();
    expect(matchShortcut(ev({ key: '?', target: input }))).toBeNull();

    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    div.appendChild(span);
    document.body.appendChild(div);
    expect(matchShortcut(ev({ key: '?', target: span }))).toBeNull();

    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(matchShortcut(ev({ key: 'k', metaKey: true, target: button }))).toBe('palette');
  });
});

describe('isEditableTarget', () => {
  it('handles non-element targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe('filterCommands', () => {
  const songs = [
    { id: 's1', name: 'Neon Nights' },
    { id: 's2', name: 'Deep Water' },
  ];

  it('empty query → nav commands only', () => {
    expect(filterCommands('', songs)).toEqual(NAV_COMMANDS);
    expect(filterCommands('   ', songs)).toEqual(NAV_COMMANDS);
  });

  it('query matches navs and songs case-insensitively', () => {
    const hits = filterCommands('nEo', songs);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'song', to: 's1', label: 'Neon Nights' });

    const lib = filterCommands('lib', songs);
    expect(lib).toHaveLength(1);
    expect(lib[0]).toMatchObject({ kind: 'nav', to: '/library' });
  });

  it('excludes archived songs (palette must agree with the library)', () => {
    const mixed = [
      { id: 'a1', name: 'Alive Track', archivedAt: null },
      { id: 'a2', name: 'Alive Track Two' },
      { id: 'x1', name: 'Archived Alive Track', archivedAt: '2026-01-01T00:00:00Z' },
    ];
    const hits = filterCommands('alive', mixed);
    expect(hits.map((h) => h.to)).toEqual(['a1', 'a2']);
  });

  it('caps song hits at 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `Track ${i}` }));
    expect(filterCommands('track', many)).toHaveLength(8);
  });
});
