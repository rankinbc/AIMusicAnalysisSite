// @vitest-environment jsdom
/* Task V1 — Rack/Coach stay full labelled tabs; Visuals becomes a compact
 * icon-only control at the end of the SAME tablist (still a real tab for
 * assistive tech). */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListenTabBar } from '../ListenTabBar';

afterEach(cleanup);

describe('ListenTabBar', () => {
  it('renders Rack and Coach as labelled tabs inside one tablist', () => {
    render(<ListenTabBar tab="rack" onSelect={vi.fn()} activeCount={2} coachCount={0} />);
    const tablist = screen.getByRole('tablist');
    const rack = screen.getByRole('tab', { name: /rack/i });
    const coach = screen.getByRole('tab', { name: /coach/i });
    expect(tablist.contains(rack)).toBe(true);
    expect(tablist.contains(coach)).toBe(true);
    expect(rack.textContent).toContain('Rack');
    expect(coach.textContent).toContain('Coach');
  });

  it('renders Visuals as a compact control with no visible text label', () => {
    render(<ListenTabBar tab="rack" onSelect={vi.fn()} activeCount={0} coachCount={0} />);
    const visuals = screen.getByRole('tab', { name: 'Visuals' });
    expect(visuals.getAttribute('aria-label')).toBe('Visuals');
    expect(visuals.getAttribute('title')).toBe('Visuals');
    expect(visuals.textContent?.trim()).toBe('');
  });

  it('is inside the same tablist as Rack and Coach', () => {
    render(<ListenTabBar tab="rack" onSelect={vi.fn()} activeCount={0} coachCount={0} />);
    const tablist = screen.getByRole('tablist');
    const visuals = screen.getByRole('tab', { name: 'Visuals' });
    expect(tablist.contains(visuals)).toBe(true);
  });

  it('activating Visuals sets aria-selected=true on it and false on the others', () => {
    render(<ListenTabBar tab="visuals" onSelect={vi.fn()} activeCount={0} coachCount={0} />);
    const visuals = screen.getByRole('tab', { name: 'Visuals' });
    const rack = screen.getByRole('tab', { name: /rack/i });
    const coach = screen.getByRole('tab', { name: /coach/i });
    expect(visuals.getAttribute('aria-selected')).toBe('true');
    expect(rack.getAttribute('aria-selected')).toBe('false');
    expect(coach.getAttribute('aria-selected')).toBe('false');
  });

  it('clicking the Visuals control calls onSelect("visuals")', () => {
    const onSelect = vi.fn();
    render(<ListenTabBar tab="rack" onSelect={onSelect} activeCount={0} coachCount={0} />);
    screen.getByRole('tab', { name: 'Visuals' }).click();
    expect(onSelect).toHaveBeenCalledWith('visuals');
  });

  it('every tab shares the same aria-controls target', () => {
    render(<ListenTabBar tab="rack" onSelect={vi.fn()} activeCount={0} coachCount={0} />);
    const rack = screen.getByRole('tab', { name: /rack/i });
    const coach = screen.getByRole('tab', { name: /coach/i });
    const visuals = screen.getByRole('tab', { name: 'Visuals' });
    const target = rack.getAttribute('aria-controls');
    expect(target).toBeTruthy();
    expect(coach.getAttribute('aria-controls')).toBe(target);
    expect(visuals.getAttribute('aria-controls')).toBe(target);
  });
});
