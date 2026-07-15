import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Story 5.10 (UX-DR45) — string-level regression locks (reduced-motion test
// precedent): the report layout collapses at the lg breakpoint (1024) and
// Listen swaps to the desktop-only notice below it.

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('UX-DR45 responsive locks', () => {
  it('report layout collapses at 1024 (both layout files)', () => {
    const mod = read('../../features/results/ReportView.module.css');
    const rdx = read('../../features/results/redesign.css');
    expect(mod).toMatch(/@media \(max-width: 1023\.98px\)/);
    expect(rdx).toMatch(/@media \(max-width: 1023\.98px\)/);
    // The old 900px layout collapse must be gone from both.
    expect(mod).not.toMatch(/@media \(max-width: 900px\)/);
  });

  it('listen rack hides below 1024 and shows the notice card', () => {
    const css = read('../../features/listen-rack/listenRack.css');
    const block = css.slice(css.indexOf('.lr-desktop-notice'));
    expect(block).toMatch(/@media \(max-width: 1023\.98px\)[\s\S]*?\.lr-grid \{ display: none; \}/);
    expect(block).toMatch(/\.lr-desktop-notice \{ display: block; \}/);
  });

  it('rail accordion: summary is inert on desktop, toggleable below', () => {
    const rdx = read('../../features/results/redesign.css');
    expect(rdx).toMatch(/details\.side-card > summary\.side-h[\s\S]*?list-style: none/);
    expect(rdx).toMatch(/@media \(min-width: 1024px\)[\s\S]*?pointer-events: none/);
  });
});
