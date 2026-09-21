// @vitest-environment jsdom
// analyze-guest-upload.test.tsx — task G5 (spec G-D1/G-D4, controller
// addendum 2026-09-21). Owner's ruling: no teaser — an upload on /analyze
// gets the full product as a capped, 24-hour guest account. Covers the pure
// sequencing helper (startGuestUpload) and the page wiring: drop -> guest
// session (if needed) -> the SAME useMixUpload() mix-upload path the
// signed-in "+ New song" flow uses -> the real signed-in results route.
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

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => auth,
  useOptionalAuth: () => auth,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate }),
}));

vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));

vi.mock('../../../hooks/useMixUpload', () => ({
  useMixUpload: () => ({
    isUploading: false,
    progress: 0,
    error: null,
    upload: mockMixUpload,
    cancel: vi.fn(),
  }),
}));

import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { capture } from '../../../lib/analytics';
import { onGuestUpgrade } from '../../demo/guest-upgrade-bus';
import { AnalyzePage } from '../AnalyzePage';

const dropFile = async () => {
  const input = screen.getByTestId('anon-file-input');
  const { fireEvent } = await import('@testing-library/react');
  await fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  navigateSpy.mockReset();
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
  mockMixUpload.mockReset();
  mockMixUpload.mockResolvedValue(RES);
  vi.mocked(capture).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AnalyzePage — guest upload (no teaser)', () => {
  it('a logged-out visitor drops a file: starts a guest session, uploads once, lands on the real results route', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn().mockResolvedValue(undefined) };
    render(<AnalyzePage />);
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
    render(<AnalyzePage />);
    await dropFile();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(startDemo).not.toHaveBeenCalled();
  });

  it('a signed-in real user is sent to their library instead of minting a guest', async () => {
    const startDemo = vi.fn();
    auth = { isLoading: false, user: { id: 'u1', email: 'a@b.c', displayName: null, tier: 'free' }, startDemo };
    render(<AnalyzePage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/library' })),
    );
    expect(startDemo).not.toHaveBeenCalled();
    expect(mockMixUpload).not.toHaveBeenCalled();
  });

  it('never renders the deleted teaser copy', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    render(<AnalyzePage />);
    expect(screen.queryByText(/Create a free account to keep this report/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/#1 finding/);
  });

  it('shows a link to explore the demo', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    render(<AnalyzePage />);
    expect(screen.getByRole('link', { name: /explore the demo/i }).getAttribute('href')).toBe('/demo');
  });

  it('never renders social/community language', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn() };
    render(<AnalyzePage />);
    expect(document.body.textContent).not.toMatch(/public|shared|people|community/i);
  });

  it('a guest_restricted upload rejection opens the shared upgrade dialog with the reason', async () => {
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
        { error: { code: 'guest_restricted', message: 'M', details: { reason: 'upload_limit' } } },
        'M',
      ),
    );
    const seen: Array<[string, string | undefined]> = [];
    const off = onGuestUpgrade((r, m) => seen.push([r, m]));
    render(<AnalyzePage />);
    await dropFile();
    await waitFor(() => expect(seen).toEqual([['upload_limit', 'M']]));
    off();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a non-guest upload failure surfaces the server message on the drop zone, no navigation', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn().mockResolvedValue(undefined) };
    mockMixUpload.mockRejectedValue(new Error('File exceeds 250 MB limit.'));
    render(<AnalyzePage />);
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
    render(<AnalyzePage />);
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
});
