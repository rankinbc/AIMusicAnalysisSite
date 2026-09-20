/* Preset plumbing extracted out of ListenRackPage (spec D10). Pins the DTO →
 * RackPreset projection (drift-shaped chains are DROPPED, not rendered half)
 * and the import error path. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { toast } from 'sonner';

import { fetcher } from '../../../api/fetcher';
import type { Chain } from '../chain';
import type { RackState } from '../rackState';
import { useRackPresetActions } from '../useRackPresetActions';

const fetcherMock = vi.mocked(fetcher);
const errorSpy = vi.mocked(toast.error);
const CHAIN: Chain = { order: ['eq'], modules: {}, masterBypass: false };

function fakeRs() {
  return {
    mod: {}, order: ['eq'], masterBypass: false, presets: [],
    applyRackMod: vi.fn(), setMasterBypass: vi.fn(),
    recallPreset: vi.fn(), savePreset: vi.fn(),
  } as unknown as RackState;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRackPresetActions', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    errorSpy.mockClear();
  });

  it('projects server preset DTOs and drops ones whose chain is unreadable', async () => {
    fetcherMock.mockResolvedValue([
      { id: 'p1', name: 'Coach Mix', source: 'analysis',
        chain: { order: ['eq'], modules: { eq: { enabled: true } }, masterBypass: false } },
      { id: 'p2', name: 'Broken', source: 'user', chain: { nope: true } },
    ]);
    const { result } = renderHook(
      () => useRackPresetActions({
        versionId: 'v1', realAudio: true, rs: fakeRs(), currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]).toMatchObject({ id: 'p1', name: 'Coach Mix', n: 1 });
  });

  it('a malformed import file surfaces the parser message and saves nothing', async () => {
    fetcherMock.mockResolvedValue([]);
    const { result } = renderHook(
      () => useRackPresetActions({
        versionId: 'v1', realAudio: true, rs: fakeRs(), currentChain: CHAIN,
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.items).toEqual([]));
    fetcherMock.mockClear();

    const file = new File(['not json at all'], 'preset.json', { type: 'application/json' });
    const target = { files: [file], value: 'preset.json' } as unknown as HTMLInputElement;
    await act(async () => {
      await result.current.onImportFile({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(errorSpy).toHaveBeenCalledWith('Not valid JSON.');
    expect(fetcherMock).not.toHaveBeenCalled();
  });
});
