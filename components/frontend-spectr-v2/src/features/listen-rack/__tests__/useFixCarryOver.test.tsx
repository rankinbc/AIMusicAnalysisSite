/* Story 12.4 carry-over + the draft restore it sequences, extracted out of
 * ListenRackPage (spec D10). These three cases pin the behaviour that was in
 * the page: a carried preset overlays the rack once and flips the phase to
 * 'applied'; a failed carry NEVER touches the rack; with no carry the saved
 * draft is restored instead. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateSpy }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { ApiError, fetcher } from '../../../api/fetcher';
import type { Chain } from '../chain';
import type { RackState } from '../rackState';
import { useFixCarryOver } from '../useFixCarryOver';

const fetcherMock = vi.mocked(fetcher);

const CHAIN: Chain = { order: ['eq'], modules: {}, masterBypass: false };

function fakeRackRef() {
  const rs = {
    mod: {},
    applyRackMod: vi.fn(),
    setMasterBypass: vi.fn(),
    recallPreset: vi.fn(),
    reset: vi.fn(),
    // Only these five are reached by the hook; the cast keeps the fixture honest
    // about that instead of stubbing all 20 RackState members.
  } as unknown as RackState;
  return { ref: { current: rs }, rs };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useFixCarryOver', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    navigateSpy.mockReset();
  });

  it('applies a carried preset once and reports the module count', async () => {
    fetcherMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('/rack/presets/')) {
        return {
          id: 'p1',
          name: 'Coach Mix',
          source: 'analysis',
          chain: {
            order: ['eq', 'limiter'],
            modules: { limiter: { enabled: true, ceilingDb: -0.8 }, eq: { enabled: false } },
            masterBypass: false,
          },
        };
      }
      return null; // no saved draft
    });
    const { ref, rs } = fakeRackRef();

    const { result } = renderHook(
      () => useFixCarryOver({
        versionId: 'v1', fixPreset: 'p1', realAudio: true, rsRef: ref, currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.carryPhase).toBe('applied'));
    expect(result.current.fixesApplied).toBe(1); // only the ENABLED module counts
    expect(rs.applyRackMod).toHaveBeenCalledTimes(1);
  });

  it('a failed carry leaves the rack untouched and reports failed', async () => {
    fetcherMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('/rack/presets/')) throw new ApiError(404, undefined);
      return null;
    });
    const { ref, rs } = fakeRackRef();

    const { result } = renderHook(
      () => useFixCarryOver({
        versionId: 'v1', fixPreset: 'gone', realAudio: true, rsRef: ref, currentChain: CHAIN,
      }),
      { wrapper },
    );

    // useRackPreset carries `retry: 1` with the default ~1s exponential
    // backoff (see useRackPresets.ts), so the error settles just past RTL's
    // default 1000ms waitFor timeout — widen it rather than the app's retry
    // policy.
    await waitFor(() => expect(result.current.carryPhase).toBe('failed'), { timeout: 3000 });
    expect(rs.applyRackMod).not.toHaveBeenCalled();
    expect(result.current.fixesApplied).toBeNull();
  });

  it('with no carry, the saved draft is restored', async () => {
    fetcherMock.mockImplementation(async () => ({
      chain: { order: ['eq'], modules: { eq: { enabled: true } }, masterBypass: true },
    }));
    const { ref, rs } = fakeRackRef();

    const { result } = renderHook(
      () => useFixCarryOver({
        versionId: 'v1', fixPreset: undefined, realAudio: true, rsRef: ref, currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(rs.recallPreset).toHaveBeenCalled());
    expect(rs.setMasterBypass).toHaveBeenCalledWith(true);
    expect(result.current.carryPhase).toBe('none');
  });
});
