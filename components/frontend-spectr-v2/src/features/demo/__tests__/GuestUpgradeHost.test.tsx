// @vitest-environment jsdom
// D10 fix1 (item 5) — layout wiring had no test. GuestUpgradeHost is the ONE
// upgrade dialog + its bus subscription, mounted by `_app.tsx` (and /analyze);
// tested here without mounting the whole authenticated shell. The banner is
// no longer part of it (root route, every page — see guest-banner-root.test).
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
import { GuestUpgradeHost } from '../GuestUpgradeHost';

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

describe('GuestUpgradeHost', () => {
  it('for a guest: subscribes to the bus and opens the dialog when it fires (no banner)', async () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
    render(<GuestUpgradeHost />, { wrapper });

    expect(screen.queryByText(/as a guest/i)).toBeNull();
    expect(onGuestUpgradeSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => openGuestUpgrade('upload_limit', 'M'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('for a real user: renders no dialog, and never subscribes to the bus', () => {
    auth = { user: { id: 'u', isGuest: false } };
    const { container } = render(<GuestUpgradeHost />, { wrapper });
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onGuestUpgradeSpy).not.toHaveBeenCalled();
  });

  it('unmount removes the listener (no leak under StrictMode double-mount)', () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
    const { unmount } = render(
      <StrictMode>
        <GuestUpgradeHost />
      </StrictMode>,
      { wrapper },
    );
    expect(unsubscribeSpy).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
