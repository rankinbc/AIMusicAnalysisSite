import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Story 2.7 / UX-DR29 — BlurLock gates depth surfaces. vitest env is `node`
// (CLAUDE.md), so we assert against static markup rather than a live DOM.

import { BlurLock } from '../BlurLock';

describe('BlurLock', () => {
  it('renders children untouched when unlocked (no overlay)', () => {
    const html = renderToStaticMarkup(
      <BlurLock locked={false} reason="locked" ctaLabel="Get Pro" onUnlock={vi.fn()}>
        <p>real content</p>
      </BlurLock>,
    );
    expect(html).toContain('real content');
    // No gating chrome in the ungated path.
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain('aria-hidden');
  });

  it('announces the lock reason and renders a single CTA when locked', () => {
    const html = renderToStaticMarkup(
      <BlurLock
        locked
        reason="Stems analysis is a Pro feature"
        ctaLabel="Get Pro"
        onUnlock={vi.fn()}
      >
        <p>real content</p>
      </BlurLock>,
    );
    // Reason is both visible copy and the overlay's accessible name.
    expect(html).toContain('Stems analysis is a Pro feature');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Stems analysis is a Pro feature"');
    // Exactly one CTA button, styled as the primary action.
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)];
    expect(buttons.length).toBe(1);
    expect(html).toMatch(/class="btn primary"/);
  });

  it('keeps the real content mounted but inert + hidden when locked', () => {
    const html = renderToStaticMarkup(
      <BlurLock locked reason="locked" ctaLabel="Get Pro" onUnlock={vi.fn()}>
        <p>real content</p>
      </BlurLock>,
    );
    // Content stays so the user sees what they're missing…
    expect(html).toContain('real content');
    // …but is removed from the a11y tree + tab order.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert');
  });
});
