import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useFixRack, useGenerateFixRack } from '../../api/hooks';
import { isGuestRestrictedError } from '../../api/mutation-error-toast';
import type { FixRackDto } from '../../api/types';
import { useBuyCredits } from '../billing/BuyCreditsProvider';
import { isOutOfCredits } from '../billing/credits';

export type FixRackGenPhase = 'idle' | 'generating' | 'error' | 'timeout';

/** How long we wait for the worker to persist a preset before flipping to the
 *  timeout state. Matches the useFixRack poll cap (100 polls × 1.5 s). */
export const FIX_RACK_POLL_WINDOW_MS = 150_000;

/** Shared Fix Rack generation lifecycle — one state machine for the coach
 *  header button (ReportView) and the sidebar panel (FixRackPanel), with the
 *  failure paths the original boolean flag lacked: a failed POST lands in
 *  'error', a worker that never persists a preset lands in 'timeout' (the GET
 *  otherwise 204s forever), and generate() from either state retries cleanly.
 *  A non-null `rack` always wins over `phase` — consumers render ready off it. */
export function useFixRackGeneration(jobId: string): {
  phase: FixRackGenPhase;
  rack: FixRackDto | null;
  generate: () => void;
  isPosting: boolean;
} {
  const qc = useQueryClient();
  const gen = useGenerateFixRack(jobId);
  const buyCredits = useBuyCredits();
  const [phase, setPhase] = useState<FixRackGenPhase>('idle');
  const fixRack = useFixRack(jobId, phase === 'generating');
  const rack = fixRack.data ?? null;
  // Each generation is charged server-side, so a double-click or a re-fired
  // callback must not start a second one while the first is still compiling.
  // A ref (not `phase`) so it holds within the same tick, before a re-render.
  const inFlight = useRef(false);

  const generate = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    // resetQueries (not invalidateQueries): zeroes dataUpdateCount so the poll
    // cap restarts, and clears cached data so a Regenerate isn't satisfied by
    // the stale rack (which used to stop refetchInterval on the first poll).
    void qc.resetQueries({ queryKey: ['fix-rack', jobId] });
    setPhase('generating');
    gen.mutate(undefined, {
      onError: (err) => {
        inFlight.current = false;
        // Guest cap: the mutation cache already opened the upgrade dialog.
        if (isGuestRestrictedError(err)) {
          setPhase('idle');
          return;
        }
        if (isOutOfCredits(err)) {
          setPhase('idle');
          buyCredits.open({ title: 'Not enough credits', onBought: () => generate() });
          return;
        }
        setPhase('error');
        toast.error(err.message);
      },
    });
  }, [qc, gen, jobId, buyCredits]);

  // The generation is over once its rack lands or the wait gives up.
  useEffect(() => {
    if (rack != null || phase === 'timeout' || phase === 'error') inFlight.current = false;
  }, [rack, phase]);

  // Timeout watchdog: while waiting on the worker with nothing to show, arm a
  // single timer; a rack arriving (or a phase change) disarms it.
  useEffect(() => {
    if (phase !== 'generating' || rack != null) return;
    const t = setTimeout(() => setPhase('timeout'), FIX_RACK_POLL_WINDOW_MS);
    return () => clearTimeout(t);
  }, [phase, rack]);

  return { phase, rack, generate, isPosting: gen.isPending };
}
