// @vitest-environment jsdom
// D10 fix1 (item 1) — UnifiedUploadDialog's dispatch step runs the whole
// mix/.als/reference/stems/analyze sequence with raw fetcher()/XHR calls
// inside a hand-written try/catch, NEVER useMutation (the hooks capture
// versionId at render time — a known stale-closure trap, see CLAUDE.md).
// The app's global MutationCache therefore never sees these errors. This
// test drives the REAL handleSubmit → runUpload → dispatch fetcher() call
// through the rendered component (mix-only path: no stems/.als/reference)
// and asserts the catch now routes a guest_restricted 403 through the same
// shared helper the MutationCache uses — bus fires, no toast, analytics
// fires once — while a non-guest 403 still toasts, and a 429 guest_busy
// toasts the server message without opening the dialog.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/analytics', () => ({ capture: vi.fn() }));

vi.mock('../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

vi.mock('../../api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/hooks')>();
  return {
    ...actual,
    useCreateSong: () => ({ mutateAsync: vi.fn() }),
    useEntitlements: () => ({ isLoading: false, data: undefined }),
    useReferences: () => ({ data: undefined }),
    useSongs: () => ({ data: undefined }),
    useStemProposals: () => ({ data: undefined, isError: false }),
  };
});

vi.mock('../../features/demo/useGuestState', () => ({
  useGuestState: () => ({ isGuest: false, canUpload: true, state: undefined }),
}));

const mockMixUpload = vi.fn();
vi.mock('../../hooks/useMixUpload', () => ({
  useMixUpload: () => ({
    isUploading: false,
    progress: 0,
    error: null,
    upload: mockMixUpload,
    cancel: vi.fn(),
  }),
}));

import { ApiError, fetcher } from '../../api/fetcher';
import { capture } from '../../lib/analytics';
import { onGuestUpgrade } from '../../features/demo/guest-upgrade-bus';
import { toast } from 'sonner';
import { UnifiedUploadDialog } from '../UnifiedUploadDialog';

async function submitWithMix() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UnifiedUploadDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const file = new File(['x'], 'mix.wav', { type: 'audio/wav' });
  const input = screen.getByTestId('mix-file-input');
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  const submit = screen.getByRole('button', { name: /upload & analyze/i });
  await act(async () => {
    fireEvent.click(submit);
  });
}

beforeEach(() => {
  mockMixUpload.mockReset();
  mockMixUpload.mockResolvedValue({ versionId: 'v1', songId: 's1', jobId: null });
  vi.mocked(fetcher).mockReset();
  vi.mocked(capture).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(cleanup);

describe('UnifiedUploadDialog dispatch-step guest_restricted routing', () => {
  it('routes a guest_restricted dispatch failure through the shared helper: bus fires once, no toast', async () => {
    vi.mocked(fetcher).mockRejectedValue(
      new ApiError(
        403,
        { error: { code: 'guest_restricted', message: 'M', details: { reason: 'analysis_limit' } } },
        'M',
      ),
    );
    const seen: Array<[string, string | undefined]> = [];
    const off = onGuestUpgrade((r, m) => seen.push([r, m]));
    await submitWithMix();
    await waitFor(() => expect(seen).toEqual([['analysis_limit', 'M']]));
    off();
    expect(toast.error).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('demo_guest_restricted', { reason: 'analysis_limit' });
  });

  it('a non-guest 403 still toasts as before and never opens the dialog', async () => {
    vi.mocked(fetcher).mockRejectedValue(
      new ApiError(403, { error: { code: 'forbidden', message: 'Nope.' } }, 'Nope.'),
    );
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    await submitWithMix();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    off();
    expect(seen).toEqual([]);
  });

  it('a 429 guest_busy toasts the server message and does not open the dialog', async () => {
    vi.mocked(fetcher).mockRejectedValue(
      new ApiError(
        429,
        { error: { code: 'guest_busy', message: 'Still uploading your last file — try again shortly.' } },
        'Still uploading your last file — try again shortly.',
      ),
    );
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    await submitWithMix();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Still uploading your last file — try again shortly.'),
      ),
    );
    off();
    expect(seen).toEqual([]);
  });
});
