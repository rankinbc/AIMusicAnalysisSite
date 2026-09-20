/* The Listen page's findings seam.
 *
 * Called ONCE per page. It owns the page's only useFixOverlay instance (spec
 * D11): the stage board and the Coach tab's fixes column both drive this one
 * handle. Two instances would each hold their own fix-free baseline and each
 * rebuild the whole rack from it, so a toggle in one silently discarded the
 * other's contribution.
 *
 * It fetches verdicts and nothing else (spec D12): FixBoard derives every row
 * from `verdicts` and reaches `moves` only through `move.verdictId`, so the
 * rule-engine prose moves that `final_json` would add are invisible to it by
 * construction.
 */
import { useCallback, useMemo, useRef } from 'react';

import { useVerdicts } from '../../../api/hooks';
import type { VerdictDto } from '../../../api/types';
import { buildMoves, type Move } from '../../results/move-model';
import type { RackState } from '../rackState';
import { useFixOverlay } from '../useFixOverlay';
import { boardListenFixes } from './findings-helpers';

export interface FixOverlayHandle {
  isApplied: (fixId: string) => boolean;
  toggle: (fixId: string) => void;
  /** F1 — can this id be resolved into ops at all? The Coach tab's rows come
   *  from a localStorage queue that can outlive the analysis behind them, and
   *  toggling one the overlay cannot resolve used to reset the whole rack. */
  canToggle: (fixId: string) => boolean;
}

export type ListenFindingsStatus = 'no-analysis' | 'loading' | 'error' | 'ready';

export interface ListenFindings {
  status: ListenFindingsStatus;
  jobId: string | null;
  verdicts: VerdictDto[];
  moves: Move[];
  /** Fix ids currently ON the live rack (spec D2 — never the server's flag). */
  appliedIds: ReadonlySet<string>;
  overlay: FixOverlayHandle;
  retry: () => void;
}

export function useListenFindings({ versionId, latestJobId, rs }: {
  versionId: string;
  /** Spec D3 — the newest analysis FOR THE PLAYING VERSION. Never the song's. */
  latestJobId: string | null;
  rs: RackState;
}): ListenFindings {
  const jobId = latestJobId ?? null;
  // The board never kicks off a specialist, so nothing is ever optimistically
  // running; a ref keeps the identity stable so useVerdicts doesn't re-poll.
  const emptySetRef = useRef<ReadonlySet<string>>(new Set<string>());
  const query = useVerdicts(jobId ?? '', {
    enabled: Boolean(jobId),
    optimisticRunning: emptySetRef.current,
  });

  const verdicts = useMemo<VerdictDto[]>(() => query.data?.verdicts ?? [], [query.data]);
  const moves = useMemo(() => buildMoves({ verdicts }), [verdicts]);
  const fixes = useMemo(() => boardListenFixes(moves), [moves]);

  // The live module map, read through a ref so the overlay's baseline capture
  // never re-arms just because a knob moved.
  const modRef = useRef(rs.mod);
  modRef.current = rs.mod;
  const getLiveMod = useCallback(() => modRef.current, []);

  const { appliedIds, isApplied, toggle, canToggle } = useFixOverlay({
    versionId, fixes, applyRackMod: rs.applyRackMod, getLiveMod,
  });

  const appliedSet = useMemo<ReadonlySet<string>>(() => new Set(appliedIds), [appliedIds]);
  const overlay = useMemo<FixOverlayHandle>(
    () => ({ isApplied, toggle, canToggle }), [isApplied, toggle, canToggle]);

  // `refetch()` ignores `enabled`, so with no job it would request
  // `/reports//verdicts/`. Refs keep `retry`'s identity stable.
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;
  const retry = useCallback(() => { if (jobIdRef.current) void refetchRef.current(); }, []);

  const status: ListenFindingsStatus = !jobId
    ? 'no-analysis'
    : query.isError
      ? 'error'
      : query.data == null
        ? 'loading'
        : 'ready';

  // F5 — a stable identity when nothing changed: consumers take the whole
  // object as a prop, so a fresh one every render re-renders the board (and
  // re-fires any `[findings]`-dep effect) for nothing.
  return useMemo(
    () => ({ status, jobId, verdicts, moves, appliedIds: appliedSet, overlay, retry }),
    [status, jobId, verdicts, moves, appliedSet, overlay, retry]);
}
