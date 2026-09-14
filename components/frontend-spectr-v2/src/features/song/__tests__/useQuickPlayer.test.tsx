// C1 regression: cold-navigation deck population.
// useQuickPlayer is called while useSong is still loading (versions=[]);
// the non-lazy useState init resolves to null. The effect added in the C1 fix
// must populate slotA/slotB once versions arrive without clobbering an
// explicit user pick.
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { VersionDto } from '../../../api/types';
import { useQuickPlayer } from '../useQuickPlayer';

function makeVersion(n: number, isCurrent = false): VersionDto {
  return {
    id: `v${n}`,
    songId: 'song-1',
    versionNumber: n,
    label: null,
    isCurrent,
    filePath: `track-v${n}.wav`,
    createdAt: '2026-01-01T00:00:00Z',
    alsFilePath: null,
    referencePath: null,
    latestResult: null,
    personalScore: null,
  };
}

describe('useQuickPlayer — C1 cold-load deck population', () => {
  it('slotA/slotB are null on first render when versions=[] (the loading state)', () => {
    const { result } = renderHook(() => useQuickPlayer([]));
    expect(result.current.slotA).toBeNull();
    expect(result.current.slotB).toBeNull();
  });

  it('populates slotA/slotB once versions arrive after the initial empty render', async () => {
    const { result, rerender } = renderHook(
      ({ versions }: { versions: VersionDto[] }) => useQuickPlayer(versions),
      { initialProps: { versions: [] as VersionDto[] } },
    );

    // Confirm empty initial state (this is the cold-load null that C1 fixes).
    expect(result.current.slotA).toBeNull();
    expect(result.current.slotB).toBeNull();

    const versions = [makeVersion(2, true), makeVersion(1, false)];
    await act(async () => {
      rerender({ versions });
    });

    // Both decks must now be populated.
    expect(result.current.slotA).not.toBeNull();
    expect(result.current.slotB).not.toBeNull();
  });

  it('does not clobber an explicit user pick when more versions arrive', async () => {
    const v1 = makeVersion(1, false);
    const v2 = makeVersion(2, true);
    const { result, rerender } = renderHook(
      ({ versions }: { versions: VersionDto[] }) => useQuickPlayer(versions),
      { initialProps: { versions: [v1, v2] } },
    );

    // Slots start as defaultSlots (v2 is current → slot A).
    const initialA = result.current.slotA;
    expect(initialA).toBe(v2.id);

    // Simulate a re-render with the same versions list (e.g. after refetch).
    await act(async () => {
      rerender({ versions: [v1, v2] });
    });

    // The explicit pick must not be overwritten.
    expect(result.current.slotA).toBe(initialA);
  });
});
