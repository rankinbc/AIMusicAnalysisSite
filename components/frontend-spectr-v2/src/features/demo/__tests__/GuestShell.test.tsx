// @vitest-environment jsdom
// D10 fix1 (item 5) — layout wiring had no test. GuestShell is the banner +
// the ONE upgrade dialog + its bus subscription, extracted from `_app.tsx`
// so this is testable without mounting the whole authenticated shell.
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockAuthState {
  user: { id: string; isGuest?: boolean } | null;
}
let auth: MockAuthState;

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});
vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to, search, className }: any) => {
    const qs =
      search && Object.keys(search).length > 0
        ? `?${new URLSearchParams(search as Record<string, string>).toString()}`
        : '';
    return (
      <a className={className} href={`${String(to)}${qs}`}>
        {children}
      </a>
    );
  },
}));

const onGuestUpgradeSpy = vi.fn();
const unsubscribeSpy = vi.fn();
vi.mock('../guest-upgrade-bus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../guest-upgrade-bus')>();
  return {
    ...actual,
    onGuestUpgrade: (cb: Parameters<typeof actual.onGuestUpgrade>[0]) => {
      onGuestUpgradeSpy();
      const off = actual.onGuestUpgrade(cb);
      return () => {
        unsubscribeSpy();
        off();
      };
    },
  };
});

import { fetcher } from '../../../api/fetcher';
import { openGuestUpgrade } from '../guest-upgrade-bus';
import { GuestShell } from '../GuestShell';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
  onGuestUpgradeSpy.mockReset();
  unsubscribeSpy.mockReset();
});

afterEach(cleanup);

describe('GuestShell', () => {
  it('for a guest: shows the banner, subscribes to the bus, and opens the dialog when it fires', async () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
    render(<GuestShell />, { wrapper });

    expect(screen.getByText(/as a guest/i)).toBeTruthy();
    expect(onGuestUpgradeSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => openGuestUpgrade('upload_limit', 'M'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('for a real user: renders neither the banner nor the dialog, and never subscribes to the bus', () => {
    auth = { user: { id: 'u', isGuest: false } };
    const { container } = render(<GuestShell />, { wrapper });
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onGuestUpgradeSpy).not.toHaveBeenCalled();
  });

  it('unmount removes the listener (no leak under StrictMode double-mount)', () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
    const { unmount } = render(
      <StrictMode>
        <GuestShell />
      </StrictMode>,
      { wrapper },
    );
    expect(unsubscribeSpy).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
