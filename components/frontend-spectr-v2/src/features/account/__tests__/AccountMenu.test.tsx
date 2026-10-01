// @vitest-environment jsdom
// Owner ruling 2026-10-01 — guest account menu: mystery avatar, "Guest"
// header (no synthetic email), Create account CTA into the existing
// guest→account conversion (/register?from=guest), time-to-purge note, and
// no Profile / Usage / "Report a problem". Registered users are unchanged.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to, search, className, onClick }: any) => {
    const qs =
      search && Object.keys(search).length > 0
        ? `?${new URLSearchParams(search as Record<string, string>).toString()}`
        : '';
    return (
      <a
        className={className}
        href={`${String(to)}${qs}`}
        onClick={(e) => {
          e.preventDefault(); // jsdom can't navigate; the router would intercept anyway
          onClick?.(e);
        }}
      >
        {children}
      </a>
    );
  },
}));

import type { EntitlementsDto } from '../../../api/types';
import { AccountMenu, type AccountMenuProps } from '../AccountMenu';
import { GUEST_EXPIRY_FALLBACK } from '../guest-expiry';

const NOW = new Date('2026-10-01T12:00:00Z');
const HOUR = 3_600_000;

const entitlements = {
  analysesRemaining: 2,
  coachRemaining: 5,
  stemsEnabled: true,
  alsEnabled: true,
  fullVerdictsEnabled: true,
  historyDepth: null,
  tier: 'free',
  analysesLimit: 3,
  analysesUsed: 1,
  creditsEnabled: true,
} as EntitlementsDto;

function renderMenu(overrides: Partial<AccountMenuProps> = {}) {
  const onSignOut = vi.fn();
  const props: AccountMenuProps = {
    email: 'guest-382b0c@guest.spectr.invalid',
    isGuest: true,
    guestExpiresAt: new Date(NOW.getTime() + 23.2 * HOUR).toISOString(),
    creditsOn: true,
    entitlements,
    onSignOut,
    ...overrides,
  };
  render(<AccountMenu {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
  return { onSignOut };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('AccountMenu — guest', () => {
  it('shows the mystery-person avatar instead of an initial', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: /account menu/i });
    expect(button.querySelector('[data-testid="mystery-avatar"]')).not.toBeNull();
    expect(button.textContent).not.toContain('G');
    expect(button.querySelector('svg text')?.textContent).toBe('?');
  });

  it('names the account "Guest" and never shows the synthetic email', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Guest');
    expect(menu.textContent).not.toMatch(/signed in as/i);
    expect(menu.textContent).not.toContain('guest.spectr.invalid');
  });

  it('drops Profile, Usage and Report a problem but keeps meter, Billing and Sign out', () => {
    const { onSignOut } = renderMenu();
    const menu = screen.getByRole('menu');
    expect(screen.queryByText('Profile')).toBeNull();
    expect(screen.queryByText('Usage')).toBeNull();
    expect(screen.queryByText(/report a problem/i)).toBeNull();
    expect(screen.getByLabelText('Analyses: 1 of 3')).toBeTruthy();
    expect(screen.getByText('Billing').getAttribute('href')).toBe('/billing');
    fireEvent.click(screen.getByText('Sign out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(menu.isConnected).toBe(false);
  });

  it('puts a primary Create account CTA into the guest conversion flow above the meter', () => {
    renderMenu();
    const cta = screen.getByText('Create account');
    expect(cta.getAttribute('href')).toBe('/register?from=guest');
    expect(cta.className).toContain('btn');
    expect(cta.className).toContain('primary');
    const meter = screen.getByLabelText('Analyses: 1 of 3');
    // CTA precedes the meter in document order.
    expect(cta.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cta);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('states the hours until purge, rounded up', () => {
    renderMenu();
    expect(
      screen.getByText('Create an account to keep your progress. It will be deleted in 24 hours.'),
    ).toBeTruthy();
  });

  it('uses the singular at exactly one hour', () => {
    renderMenu({ guestExpiresAt: new Date(NOW.getTime() + HOUR).toISOString() });
    expect(screen.getByText(/It will be deleted in 1 hour\.$/)).toBeTruthy();
  });

  it('says "less than 1 hour" when under an hour remains', () => {
    renderMenu({ guestExpiresAt: new Date(NOW.getTime() + 20 * 60_000).toISOString() });
    expect(screen.getByText(/It will be deleted in less than 1 hour\.$/)).toBeTruthy();
  });

  it('falls back to generic copy when the expiry is unknown', () => {
    renderMenu({ guestExpiresAt: undefined });
    expect(screen.getByText(GUEST_EXPIRY_FALLBACK)).toBeTruthy();
  });
});

describe('AccountMenu — registered user (unchanged)', () => {
  it('keeps the initial avatar, email header and every item', () => {
    const { onSignOut } = renderMenu({
      isGuest: false,
      email: 'brian@example.com',
      guestExpiresAt: undefined,
    });
    const button = screen.getByRole('button', { name: /account menu/i });
    expect(button.textContent).toBe('B');
    expect(button.querySelector('[data-testid="mystery-avatar"]')).toBeNull();

    const menu = screen.getByRole('menu');
    expect(menu.textContent).toMatch(/signed in as/i);
    expect(menu.textContent).toContain('brian@example.com');
    expect(screen.getByText('Profile').getAttribute('href')).toBe('/profile');
    expect(screen.getByText('Usage').getAttribute('href')).toBe('/usage');
    expect(screen.getByLabelText('Analyses: 1 of 3')).toBeTruthy();
    expect(screen.getByText('Billing').getAttribute('href')).toBe('/billing');
    expect(screen.getByText(/report a problem/i)).toBeTruthy();
    expect(screen.queryByText('Create account')).toBeNull();
    expect(menu.textContent).not.toMatch(/keep your progress/i);

    const labels = Array.from(menu.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(labels).toEqual(['Profile', 'Usage', 'Billing', 'Report a problem', 'Sign out']);
    fireEvent.click(screen.getByText('Sign out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('hides Usage and the meter when credits are disabled (existing behavior)', () => {
    renderMenu({ isGuest: false, email: 'b@x.com', creditsOn: false });
    expect(screen.queryByText('Usage')).toBeNull();
    expect(screen.queryByLabelText('Analyses: 1 of 3')).toBeNull();
    expect(screen.getByText('Billing')).toBeTruthy();
  });
});
