import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EvidenceChips } from '../EvidenceChips';

// Story 1.8 / Task 5 / AC3 — EvidenceChips renders one Pill per evidence
// item and carries a descriptive aria-label on each chip. Renders to
// static markup so the project stays jsdom-free (story 1.7 pattern).

describe('EvidenceChips', () => {
  it('returns null for empty / null evidence (no empty role=group)', () => {
    expect(renderToStaticMarkup(<EvidenceChips evidence={null} />)).toBe('');
    expect(renderToStaticMarkup(<EvidenceChips evidence={[]} />)).toBe('');
  });

  it('renders one Pill per evidence item with the label as text', () => {
    const html = renderToStaticMarkup(
      <EvidenceChips
        evidence={[
          { label: 'LUFS −11.2', path: 'verdict-loudness' },
          { label: 'SUB-DEEP 65 Hz', path: 'spectrum' },
        ]}
      />,
    );
    expect(html).toContain('LUFS −11.2');
    expect(html).toContain('SUB-DEEP 65 Hz');
    // Two pill spans (story 1.7's <Pill tone="cyan">)
    const pillMatches = html.match(/class="pill cyan"/g) ?? [];
    expect(pillMatches.length).toBe(2);
  });

  it('wraps clickable chips (path set) in a <button> for keyboard activation', () => {
    const html = renderToStaticMarkup(
      <EvidenceChips evidence={[{ label: 'A', path: 'verdict-x' }]} />,
    );
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  it('renders chips without a path as static Pills (no <button>)', () => {
    const html = renderToStaticMarkup(
      <EvidenceChips evidence={[{ label: 'context-only', path: '' }]} />,
    );
    expect(html).not.toMatch(/<button/);
    expect(html).toContain('context-only');
  });

  it('carries aria-label "Cite: {label}" on each chip', () => {
    const html = renderToStaticMarkup(
      <EvidenceChips evidence={[{ label: 'LUFS −11.2', path: 'verdict-loudness' }]} />,
    );
    expect(html).toContain('aria-label="Cite: LUFS −11.2, scroll to source"');
  });

  it('uses role="group" with descriptive aria-label on the container', () => {
    const html = renderToStaticMarkup(
      <EvidenceChips evidence={[{ label: 'A', path: 'b' }]} />,
    );
    expect(html).toMatch(/role="group"/);
    expect(html).toMatch(/aria-label="Evidence cited by the coach"/);
  });
});
