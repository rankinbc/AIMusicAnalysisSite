import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GradePill } from '../GradePill';

// Story 1.7 / UX-DR4 / AC4 — GradePill must expose the grade letter to
// screen readers as "Grade: X" (the bare letter is ambiguous in prose).
// Implemented via role="img" + aria-label on the container — robust
// against AT that mishandle nested aria-hidden / sr-only spans, and
// avoids DOM-order announcement quirks (NVDA, JAWS legacy).
// We render to static markup rather than DOM because the project has no
// jsdom dependency; the markup assertion gives the same guarantee.

describe('GradePill', () => {
  it('renders the visible grade letter for sighted users', () => {
    const html = renderToStaticMarkup(<GradePill grade="A" />);
    expect(html).toContain('>A<');
  });

  it('exposes "Grade: A" to screen readers via role="img" + aria-label', () => {
    const html = renderToStaticMarkup(<GradePill grade="A" />);
    expect(html).toMatch(/role="img"/);
    expect(html).toMatch(/aria-label="Grade: A"/);
  });

  it('marks the visible letter aria-hidden so it is not read twice', () => {
    const html = renderToStaticMarkup(<GradePill grade="F" size="lg" />);
    expect(html).toMatch(/aria-hidden="true">F</);
    expect(html).toMatch(/aria-label="Grade: F"/);
  });

  it('handles each size without crashing', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const html = renderToStaticMarkup(<GradePill grade="B" size={size} />);
      expect(html).toContain('aria-label="Grade: B"');
    }
  });
});
