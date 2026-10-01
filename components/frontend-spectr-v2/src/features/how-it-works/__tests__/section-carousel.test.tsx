// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HowItWorksPage } from '../HowItWorksPage';
import { SectionCarousel } from '../SectionCarousel';

const SECTIONS = [
  { id: 'a', label: 'Alpha', dwellMs: 1000, content: <h2>Section A</h2> },
  { id: 'b', label: 'Beta', dwellMs: 2000, content: <h2>Section B</h2> },
  { id: 'c', label: 'Gamma', dwellMs: 1000, content: <h2>Section C</h2> },
];

const selected = (c: HTMLElement) => c.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const visiblePanel = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((p) => !p.hidden).map((p) => p.dataset.panel);

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SectionCarousel', () => {
  it('renders WAI-ARIA tabs wired to their panels, first selected, roving tabindex', () => {
    const { container } = render(<SectionCarousel label="Sections" sections={SECTIONS} />);
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Sections');
    expect(tabs.map((t) => t.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    for (const t of tabs) {
      const panel = container.querySelector(`#${t.getAttribute('aria-controls')}`)!;
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(t.id);
    }
    expect(visiblePanel(container)).toEqual(['a']);
  });

  it('auto-advances after each dwell and wraps around', () => {
    const { container } = render(<SectionCarousel label="Sections" sections={SECTIONS} />);
    act(() => vi.advanceTimersByTime(1100));
    expect(selected(container)).toBe('Beta');
    act(() => vi.advanceTimersByTime(1000)); // Beta dwells 2 s
    expect(selected(container)).toBe('Beta');
    act(() => vi.advanceTimersByTime(1100));
    expect(selected(container)).toBe('Gamma');
    act(() => vi.advanceTimersByTime(1100));
    expect(selected(container)).toBe('Alpha');
    act(() => vi.advanceTimersByTime(700)); // slide-out finished, before the next dwell ends
    expect(visiblePanel(container)).toEqual(['a']);
  });

  it('clicking a tab selects and pins it; play resumes rotation', () => {
    const { container, getByText, getByTestId } = render(<SectionCarousel label="Sections" sections={SECTIONS} />);
    fireEvent.click(getByText('Gamma'));
    expect(selected(container)).toBe('Gamma');
    expect(getByTestId('hiw-carousel').dataset.playing).toBe('false');
    expect(getByTestId('hiw-carousel-toggle').getAttribute('aria-label')).toBe('Play section rotation');
    act(() => vi.advanceTimersByTime(10_000));
    expect(selected(container)).toBe('Gamma');
    fireEvent.click(getByTestId('hiw-carousel-toggle'));
    act(() => vi.advanceTimersByTime(1100));
    expect(selected(container)).toBe('Alpha');
  });

  it('arrow keys, Home and End move between tabs and pin', () => {
    const { container } = render(<SectionCarousel label="Sections" sections={SECTIONS} />);
    const list = container.querySelector('[role="tablist"]')!;
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(selected(container)).toBe('Beta');
    expect(document.activeElement?.textContent).toBe('Beta');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(selected(container)).toBe('Gamma');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(selected(container)).toBe('Alpha');
    fireEvent.keyDown(list, { key: 'End' });
    expect(selected(container)).toBe('Gamma');
    act(() => vi.advanceTimersByTime(10_000));
    expect(selected(container)).toBe('Gamma');
  });

  it('pauses while the pointer is over the stage', () => {
    const { container } = render(<SectionCarousel label="Sections" sections={SECTIONS} />);
    const stage = container.querySelector('[role="tabpanel"]')!.parentElement!;
    fireEvent.pointerEnter(stage);
    act(() => vi.advanceTimersByTime(5000));
    expect(selected(container)).toBe('Alpha');
    fireEvent.pointerLeave(stage);
    act(() => vi.advanceTimersByTime(1100));
    expect(selected(container)).toBe('Beta');
  });

  it('never auto-advances under prefers-reduced-motion (tabs still work)', () => {
    mockReducedMotion(true);
    const { container, getByText, queryByTestId } = render(<SectionCarousel label="Sections" sections={SECTIONS} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(selected(container)).toBe('Alpha');
    expect(queryByTestId('hiw-carousel-toggle')).toBeNull();
    fireEvent.click(getByText('Beta'));
    expect(visiblePanel(container)).toEqual(['b']);
    expect(container.querySelector('[data-anim]')).toBeNull();
  });
});

describe('How it works carousel', () => {
  const html = renderToStaticMarkup(<HowItWorksPage />);

  it('tabs every main section in page order, keeping header, intro and CTA outside it', () => {
    const tabs = [...html.matchAll(/role="tab"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['pipeline', 'findings', 'coach', 'steps', 'different', 'daw']);
    const start = html.indexOf('data-testid="hiw-carousel"');
    expect(html.indexOf('<h1')).toBeLessThan(start);
    expect(html.indexOf('score and a list of problems')).toBeLessThan(start);
    expect(html.indexOf('See it for yourself')).toBeGreaterThan(html.indexOf('data-panel="daw"'));
  });

  it('keeps every section heading in the static HTML', () => {
    for (const h of [
      'The analysis pipeline',
      'What it finds — and what it tells you to do',
      'Meet the Coach',
      'From upload to a plan',
      'What makes it different',
      'Take it back to your DAW',
    ]) {
      expect(html).toContain(h);
    }
  });
});
