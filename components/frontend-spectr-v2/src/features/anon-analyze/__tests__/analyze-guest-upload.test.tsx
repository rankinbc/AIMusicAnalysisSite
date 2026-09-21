// @vitest-environment jsdom
// analyze-guest-upload.test.tsx — task G5 (spec G-D1/G-D4, controller
// addendum 2026-09-21) + G5 fix1 (Opus review of 39fe15a/718b0f9/2971855).
// Owner's ruling: no teaser — an upload on /analyze gets the full product as
// a capped, 24-hour guest account. Covers the pure sequencing helper
// (startGuestUpload) and the page wiring: drop -> guest session (if needed)
// -> the SAME useMixUpload() mix-upload path the signed-in "+ New song" flow
// uses -> the real signed-in results route.
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../api/fetcher';
import type { AuthedUser, UploadResponse } from '../../../api/types';
import { GuestStartFailedError, startGuestUpload } from '../startGuestUpload';

const RES: UploadResponse = { songId: 's', versionId: 'v', jobId: 'j' };
const file = new File(['x'], 'mix.wav', { type: 'audio/wav' });

describe('startGuestUpload', () => {
  it('starts a guest session first when nobody is signed in', async () => {
    const order: string[] = [];
    const res = await startGuestUpload(
      {
        user: null,
        startDemo: vi.fn(async () => {
          order.push('demo');
        }),
        upload: vi.fn(async () => {
          order.push('upload');
          return RES;
        }),
      },
      file,
    );
    expect(order).toEqual(['demo', 'upload']);
    expect(res).toEqual(RES);
  });

  it('never starts a second session for someone already signed in (real user or existing guest)', async () => {
    const realUser: AuthedUser = { id: 'u', email: 'a@b.c', displayName: null, tier: 'free' };
    const startDemo = vi.fn();
    await startGuestUpload({ user: realUser, startDemo, upload: async () => RES }, file);
    expect(startDemo).not.toHaveBeenCalled();

    const guest: AuthedUser = {
      id: 'g1',
      email: 'guest-g1@guest.spectr.invalid',
      displayName: null,
      tier: 'free',
      isGuest: true,
    };
    const startDemo2 = vi.fn();
    await startGuestUpload({ user: guest, startDemo: startDemo2, upload: async () => RES }, file);
    expect(startDemo2).not.toHaveBeenCalled();
  });

  it('does not upload when the guest session cannot start', async () => {
    const upload = vi.fn();
    await expect(
      startGuestUpload(
        { user: null, startDemo: async () => { throw new Error('demo_unavailable'); }, upload },
        file,
      ),
    ).rejects.toThrow('demo_unavailable');
    expect(upload).not.toHaveBeenCalled();
  });

  it('wraps the startDemo failure so callers can tell it apart from an upload failure', async () => {
    await expect(
      startGuestUpload(
        { user: null, startDemo: async () => { throw new Error('nope'); }, upload: vi.fn() },
        file,
      ),
    ).rejects.toBeInstanceOf(GuestStartFailedError);
  });
});

// ── the page ──────────────────────────────────────────────────────────────

interface MockAuthState {
  isLoading: boolean;
  user: AuthedUser | null;
  startDemo: () => Promise<unknown>;
}

let auth: MockAuthState;
const navigateSpy = vi.fn();
const invalidate = vi.fn().mockResolvedValue(undefined);
const mockMixUpload = vi.fn<(file: File) => Promise<UploadResponse>>();
const mockCancel = vi.fn();
const mixUploadState: { isUploading: boolean; progress: number; error: string | null } = {
  isUploading: false,
  progress: 0,
  error: null,
};
const invalidateGuestStateSpy = vi.fn();

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => auth,
  useOptionalAuth: () => auth,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate }),
  // GuestUpgradeDialog (rendered by GuestUpgradeHost, mounted by AnalyzePage
  // itself) links to /register with a TanStack <Link> — same stub as
  // GuestShell.test.tsx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to, search, className, onClick }: any) => {
    const qs =
      search && Object.keys(search).length > 0
        ? `?${new URLSearchParams(search as Record<string, string>).toString()}`
        : '';
    return (
      <a className={className} href={`${String(to)}${qs}`} onClick={onClick}>
        {children}
      </a>
    );
  },
}));

vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));

vi.mock('../../../hooks/useMixUpload', () => ({
  useMixUpload: () => ({ ...mixUploadState, upload: mockMixUpload, cancel: mockCancel }),
}));

// Item 1 — GuestUpgradeHost is mounted by AnalyzePage itself (what the route
// renders); its `useGuestState()` call needs a real QueryClientProvider in
// the tree (added by `renderPage()` below), so `fetcher` (its only network
// dependency) is mocked here rather than left to hit the network in jsdom.
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn().mockReturnValue(new Promise(() => {})) };
});

// Item 2 — `invalidateGuestState` is the ONE place that knows the guest-state
// query key; spied here (not exercised for real) so the success path's call
// order is directly assertable. `useGuestState` itself stays behavior-real
// (driven off the same mocked `auth`) so GuestUpgradeHost's isGuest gating
// still exercises real logic.
vi.mock('../../demo/useGuestState', () => ({
  useGuestState: () => ({ isGuest: auth?.user?.isGuest === true, canUpload: true, state: undefined }),
  invalidateGuestState: (...args: unknown[]) => invalidateGuestStateSpy(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach } from 'vitest';

import { capture } from '../../../lib/analytics';
import { AnalyzePage } from '../AnalyzePage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<AnalyzePage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

const dropFile = async (f: File = file) => {
  const input = screen.getByTestId('anon-file-input');
  await fireEvent.change(input, { target: { files: [f] } });
};

beforeEach(() => {
  navigateSpy.mockReset();
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
  mockMixUpload.mockReset();
  mockMixUpload.mockResolvedValue(RES);
  mockCancel.mockReset();
  mixUploadState.isUploading = false;
  mixUploadState.progress = 0;
  mixUploadState.error = null;
  invalidateGuestStateSpy.mockReset();
  vi.mocked(capture).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AnalyzePage — guest upload (no teaser)', () => {
  it('a logged-out visitor drops a file: starts a guest session, uploads once, lands on the real results route', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn().mockResolvedValue(undefined) };
    renderPage();
    await dropFile();
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/songs/$songId/results/$jobId',
          params: { songId: 's', jobId: 'j' },
        }),
      ),
    );
    expect(auth.startDemo).toHaveBeenCalledTimes(1);
    expect(mockMixUpload).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('guest_upload_started', { job_id: 'j' });
  });

  it('an existing guest drops a file without a second startDemo call', async () => {
    const startDemo = vi.fn();
    auth = {
      isLoading: false,
      user: {
        id: 'g1',
        email: 'guest-g1@guest.spectr.invalid',
        displayName: null,
        tier: 'free',
        isGuest: true,
      },
      startDemo,
    };
    renderPage();
    await dropFile();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(startDemo).not.toHaveBeenCalled();
  });

  it('a signed-in real user is sent to their library instead of minting a guest', async () => {
    const startDemo = vi.fn();
    auth = { isLoading: false, user: { id: 'u1', email: 'a@b.c', displayName: null, tier: 'free' }, startDemo };
    renderPage();
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/library' })),
    );
    expect(startDemo).not.toHaveBeenCalled();
    expect(mockMixUpload).not.toHaveBeenCalled();
  });

  it('never renders the deleted teaser copy', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    renderPage();
    expect(screen.queryByText(/Create a free account to keep this report/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/#1 finding/);
  });

  it('shows a link to explore the demo', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    renderPage();
    expect(screen.getByRole('link', { name: /explore the demo/i }).getAttribute('href')).toBe('/demo');
  });

  it('never renders social/community language', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    renderPage();
    expect(document.body.textContent).not.toMatch(/public|shared|people|community/i);
  });

  // ── item 1 (CRITICAL) — a guest limit on /analyze is never a silent dead
  // end. Renders the page the way the ROUTE composes it (AnalyzePage IS the
  // route's component, unwrapped) and asserts VISIBLE text + the dialog's
  // own action — NOT a bus subscription made by the test itself, which is
  // exactly what let the original bug through review.
  it('a guest_restricted upload rejection shows the server message inline AND opens the shared upgrade dialog', async () => {
    auth = {
      isLoading: false,
      user: {
        id: 'g1',
        email: 'guest-g1@guest.spectr.invalid',
        displayName: null,
        tier: 'free',
        isGuest: true,
      },
      startDemo: vi.fn(),
    };
    mockMixUpload.mockRejectedValue(
      new ApiError(
        403,
        {
          error: {
            code: 'guest_restricted',
            message: "You've used the uploads included with a guest account.",
            details: { reason: 'upload_limit' },
          },
        },
        "You've used the uploads included with a guest account.",
      ),
    );
    renderPage();
    await dropFile();

    // The dialog — rendered by the page itself (not subscribed-to by the
    // test, which is exactly the anti-pattern that let this bug through) —
    // waited for first so both surfaces below are guaranteed settled.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Create a free account')).toBeTruthy();

    // BOTH surfaces carry the server's message: inline under the drop zone
    // (the page is never mute even if the dialog is dismissed) AND inside
    // the dialog itself.
    expect(
      screen.getAllByText("You've used the uploads included with a guest account."),
    ).toHaveLength(2);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a non-guest upload failure surfaces the server message on the drop zone, no navigation', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn().mockResolvedValue(undefined) };
    mockMixUpload.mockRejectedValue(new Error('File exceeds 250 MB limit.'));
    renderPage();
    await dropFile();
    expect(await screen.findByText(/File exceeds 250 MB limit\./)).toBeTruthy();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a guest session that cannot start shows a way forward, never a blank page', async () => {
    auth = {
      isLoading: false,
      user: null,
      startDemo: vi.fn().mockRejectedValue(new ApiError(503, { error: { code: 'demo_unavailable' } })),
    };
    renderPage();
    await dropFile();
    expect(await screen.findByText(/uploads aren.t available right now/i)).toBeTruthy();
    // Scoped to the failure card — PublicFooter (below) ALSO carries an
    // "Explore the demo" link, so an unscoped query would find two.
    const card = screen.getByRole('alert');
    const { getByRole } = within(card);
    expect(getByRole('link', { name: /create a free account/i }).getAttribute('href')).toBe(
      '/register',
    );
    expect(getByRole('link', { name: /explore the demo/i }).getAttribute('href')).toBe('/demo');
  });

  // ── item 2 (IMPORTANT) — a returning guest's second upload must not read a
  // stale cached uploadsUsed.
  it('invalidates the guest-state query on a successful upload, before the router invalidate', async () => {
    auth = {
      isLoading: false,
      user: {
        id: 'g1',
        email: 'guest-g1@guest.spectr.invalid',
        displayName: null,
        tier: 'free',
        isGuest: true,
      },
      startDemo: vi.fn(),
    };
    const order: string[] = [];
    invalidateGuestStateSpy.mockImplementation(() => order.push('guestState'));
    invalidate.mockImplementation(async () => {
      order.push('router');
    });
    renderPage();
    await dropFile();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(invalidateGuestStateSpy).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['guestState', 'router']);
  });

  // ── item 4 (IMPORTANT) — the boot refresh must never render a blank page.
  it('renders a disabled drop zone (not a blank page) while auth is loading, then enables it once loading ends', async () => {
    auth = { isLoading: true, user: null, startDemo: vi.fn() };
    const { rerender } = renderPage();
    expect(screen.getByRole('heading', { name: /drop your track/i })).toBeTruthy();
    const input = screen.getByTestId('anon-file-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    await fireEvent.change(input, { target: { files: [file] } });
    expect(auth.startDemo).not.toHaveBeenCalled();
    expect(mockMixUpload).not.toHaveBeenCalled();

    auth = { ...auth, isLoading: false };
    rerender(<AnalyzePage />);
    const input2 = screen.getByTestId('anon-file-input') as HTMLInputElement;
    expect(input2.disabled).toBe(false);
  });

  // ── item 5 (MINOR) — a bad file must never mint a guest account.
  it('rejects an unsupported file before minting a guest', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    renderPage();
    const badFile = new File(['x'], 'notes.txt', { type: 'text/plain' });
    await dropFile(badFile);
    expect(auth.startDemo).not.toHaveBeenCalled();
    expect(mockMixUpload).not.toHaveBeenCalled();
    expect(await screen.findByText(/drop an audio file/i)).toBeTruthy();
  });

  it('rejects an oversized file before minting a guest', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    renderPage();
    const bigFile = new File(['x'], 'mix.wav', { type: 'audio/wav' });
    Object.defineProperty(bigFile, 'size', { value: 251 * 1024 * 1024 });
    await dropFile(bigFile);
    expect(auth.startDemo).not.toHaveBeenCalled();
    expect(mockMixUpload).not.toHaveBeenCalled();
    expect(await screen.findByText('That file is over the 250 MB limit.')).toBeTruthy();
  });

  // ── item 8 (MINOR) — `mixUpload.cancel` was unused: no way to back out of
  // a started upload.
  it('Cancel upload aborts the XHR and returns to idle — no navigation, no orphaned error', async () => {
    auth = {
      isLoading: false,
      user: {
        id: 'g1',
        email: 'guest-g1@guest.spectr.invalid',
        displayName: null,
        tier: 'free',
        isGuest: true,
      },
      startDemo: vi.fn(),
    };
    mixUploadState.isUploading = true;
    let rejectUpload!: (err: unknown) => void;
    mockMixUpload.mockImplementation(
      () => new Promise<UploadResponse>((_resolve, reject) => { rejectUpload = reject; }),
    );
    renderPage();
    await dropFile();

    const cancelBtn = await screen.findByRole('button', { name: /cancel upload/i });
    fireEvent.click(cancelBtn);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('anon-drop-zone')).toBeTruthy();

    rejectUpload(new Error('Upload aborted'));
    await new Promise((r) => setTimeout(r, 0));
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/upload aborted/i)).toBeNull();
  });
});
