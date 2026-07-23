import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useFixRack, useGenerateFixRack } from '../../api/hooks';
import type { FixRackDto } from '../../api/types';

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
  const [phase, setPhase] = useState<FixRackGenPhase>('idle');
  const fixRack = useFixRack(jobId, phase === 'generating');
  const rack = fixRack.data ?? null;

  const generate = useCallback(() => {
    // resetQueries (not invalidateQueries): zeroes dataUpdateCount so the poll
    // cap restarts, and clears cached data so a Regenerate isn't satisfied by
    // the stale rack (which used to stop refetchInterval on the first poll).
    void qc.resetQueries({ queryKey: ['fix-rack', jobId] });
    setPhase('generating');
    gen.mutate(undefined, {
      onError: (err) => {
        setPhase('error');
        toast.error(err.message);
      },
    });
  }, [qc, gen, jobId]);

  // Timeout watchdog: while waiting on the worker with nothing to show, arm a
  // single timer; a rack arriving (or a phase change) disarms it.
  useEffect(() => {
    if (phase !== 'generating' || rack != null) return;
    const t = setTimeout(() => setPhase('timeout'), FIX_RACK_POLL_WINDOW_MS);
    return () => clearTimeout(t);
  }, [phase, rack]);

  return { phase, rack, generate, isPosting: gen.isPending };
}
