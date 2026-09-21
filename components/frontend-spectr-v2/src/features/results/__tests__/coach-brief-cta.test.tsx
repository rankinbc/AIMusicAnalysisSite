// @vitest-environment jsdom
// Task G6 — the brief's closing-line + account-creation CTA. Renders the
// server's exact sentence verbatim (G-D3 — never hard-coded) plus a link
// button to /register?from=guest that fires the guest_signup_clicked event.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureSpy } = vi.hoisted(() => ({ captureSpy: vi.fn() }));
vi.mock('../../../lib/analytics', () => ({ capture: captureSpy }));

import { CoachBriefCta } from '../CoachBriefCta';

beforeEach(() => {
  captureSpy.mockReset();
});
afterEach(cleanup);

describe('CoachBriefCta', () => {
  it('renders the exact server-supplied closing line', () => {
    render(<CoachBriefCta closingLine="Create a free account and let's save our progress — so we can make this mix awesome." />);
    expect(
      screen.getByText("Create a free account and let's save our progress — so we can make this mix awesome."),
    ).toBeTruthy();
  });

  it('renders a primary button linking to /register?from=guest', () => {
    render(<CoachBriefCta closingLine="Some line." />);
    const link = screen.getByRole('link', { name: 'Create free account' });
    expect(link.getAttribute('href')).toBe('/register?from=guest');
  });

  it('captures guest_signup_clicked when the CTA is clicked', () => {
    render(<CoachBriefCta closingLine="Some line." />);
    fireEvent.click(screen.getByRole('link', { name: 'Create free account' }));
    expect(captureSpy).toHaveBeenCalledWith('guest_signup_clicked');
  });
});
