// @vitest-environment jsdom
// D10 fix1 (item 2/3) — every mutation that changes a number `GET
// /api/me/guest` reports must invalidate that query through ONE shared
// helper, `invalidateGuestState`. This is the "does it actually invalidate,
// and is it a no-op for a real user" contract; the individual call sites
// (UnifiedUploadDialog, api/hooks.ts, useCoachSession) are covered by their
// own test files / the shared query key never fetching for `isGuest: false`.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockAuthState {
  user: { id: string; isGuest?: boolean } | null;
}
let auth: MockAuthState;

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../../../api/fetcher';
import { invalidateGuestState } from '../useGuestState';
import { useGuestState } from '../useGuestState';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
});

describe('invalidateGuestState', () => {
  it("invalidates the ['me','guest'] query key", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateGuestState(qc);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['me', 'guest'] });
  });

  it('is a no-op cost for a real user: the disabled query never fetches even after invalidation', async () => {
    auth = { user: { id: 'u', isGuest: false } };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useGuestState(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    invalidateGuestState(qc);
    // Flush a tick so any (incorrect) refetch would have started.
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// Sanity: wrapper above is exercised so eslint doesn't flag it unused if a
// future test in this file needs a mounted guest.
describe('wrapper sanity', () => {
  it('renders children', () => {
    auth = { user: { id: 'g', isGuest: true } };
    vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useGuestState(), { wrapper });
    expect(result.current.isGuest).toBe(true);
  });
});
