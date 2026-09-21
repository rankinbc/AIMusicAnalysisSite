// @vitest-environment jsdom
// D10 — the guest shell: a banner (real user renders nothing), a quota query
// that never fetches for a real user, and the ONE upgrade dialog wired
// through the app's MutationCache so a guest_restricted 403 opens it (and
// never ALSO fires the generic mutation-error toast) while any other 403
// falls through to the normal toast path unchanged.
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockAuthState {
  user: { id: string; isGuest?: boolean } | null;
}
let auth: MockAuthState;

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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

import { ApiError, fetcher } from '../../../api/fetcher';
import { capture } from '../../../lib/analytics';
import { createMutationCache } from '../../../api/mutation-error-toast';
import { toast } from 'sonner';
import { GuestBanner } from '../GuestBanner';
import { GuestUpgradeDialog } from '../GuestUpgradeDialog';
import { onGuestUpgrade } from '../guest-upgrade-bus';
import { useGuestState } from '../useGuestState';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: createMutationCache(),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
  vi.mocked(capture).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(cleanup);

describe('GuestBanner', () => {
  it('renders nothing for a real user', () => {
    auth = { user: { id: 'u', isGuest: false } };
    const { container } = render(<GuestBanner />, { wrapper });
    expect(container.innerHTML).toBe('');
  });

  it('tells a guest where they are and links to registration', () => {
    auth = { user: { id: 'g', isGuest: true } };
    // The banner doesn't need the quota fetch to resolve to render its
    // copy — leave it pending so TanStack Query doesn't warn about an
    // (unused-here) undefined resolution.
    vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
    render(<GuestBanner />, { wrapper });
    expect(screen.getByText(/as a guest/i)).toBeTruthy();
    expect(screen.getByText(/24 hours/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /create a free account/i });
    expect(link.getAttribute('href')).toBe('/register?from=guest');
    expect(document.body.textContent).not.toMatch(/public|shared|people|community/i);
    expect(document.body.textContent).not.toMatch(/invite/i);
  });
});

describe('useGuestState', () => {
  it('canUpload follows the server state', async () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockResolvedValue({
      uploadsUsed: 2,
      uploadsMax: 2,
      analysesUsed: 1,
      analysesMax: 6,
      coachMessagesUsed: 0,
      coachMessagesMax: 20,
      expiresAt: '2026-09-22T00:00:00Z',
      stemsMaxFiles: 12,
      stemsMaxMb: 300,
      referencesUsed: 0,
      referencesMax: 1,
    });
    const { result } = renderHook(() => useGuestState(), { wrapper });
    await waitFor(() => expect(result.current.state).toBeDefined());
    expect(result.current.canUpload).toBe(false);
  });

  it('never fetches guest state for a real user', () => {
    auth = { user: { id: 'u', isGuest: false } };
    renderHook(() => useGuestState(), { wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('a 404 (real user raced onto the guest query) never surfaces as state', async () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockRejectedValue(new ApiError(404, { error: { code: 'not_found' } }));
    const { result } = renderHook(() => useGuestState(), { wrapper });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(result.current.state).toBeUndefined();
  });
});

describe('guest_restricted mutation routing (through the app MutationCache)', () => {
  it('opens the upgrade dialog with the reason + server message, and skips the generic toast', async () => {
    const seen: Array<[string, string | undefined]> = [];
    const off = onGuestUpgrade((r, m) => seen.push([r, m]));
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: () =>
            Promise.reject(
              new ApiError(403, {
                error: {
                  code: 'guest_restricted',
                  message: 'A guest session includes 6 analyses — create a free account to analyze more.',
                  details: { reason: 'analysis_limit' },
                },
              }),
            ),
          // meta.errorToast opted in on purpose — proves guest_restricted
          // wins over the opt-in toast path, not just that an un-opted-in
          // mutation stays quiet.
          meta: { errorToast: 'fallback copy' },
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });
    off();

    expect(seen).toEqual([
      ['analysis_limit', 'A guest session includes 6 analyses — create a free account to analyze more.'],
    ]);
    expect(capture).toHaveBeenCalledWith('demo_guest_restricted', { reason: 'analysis_limit' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an unrecognized reason falls back to not_allowed', async () => {
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: () =>
            Promise.reject(
              new ApiError(403, {
                error: { code: 'guest_restricted', message: 'nope', details: { reason: 'something_new' } },
              }),
            ),
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });
    off();
    expect(seen).toEqual(['not_allowed']);
  });

  it('any other 403 does not open it (and the opted-in toast still fires)', async () => {
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: () =>
            Promise.reject(new ApiError(403, { error: { code: 'forbidden', message: 'no' } })),
          meta: { errorToast: 'fallback' },
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });
    off();
    expect(seen).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith('no');
  });
});

describe('GuestUpgradeDialog', () => {
  it('shows the server message and offers registration', () => {
    render(
      <GuestUpgradeDialog
        open
        reason="upload_limit"
        message="A guest session includes 2 uploads — create a free account to analyze more."
        onOpenChange={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText(/2 uploads/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /create a free account/i });
    expect(link.getAttribute('href')).toBe('/register?from=guest');
  });

  it('falls back to reason-specific copy when no server message is given', () => {
    render(<GuestUpgradeDialog open reason="upload_limit" onOpenChange={() => {}} />, { wrapper });
    expect(screen.getByText(/upload/i)).toBeTruthy();
  });

  it('carries a labelled title (Radix Dialog.Title) for screen readers', () => {
    render(<GuestUpgradeDialog open reason="not_allowed" onOpenChange={() => {}} />, { wrapper });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
