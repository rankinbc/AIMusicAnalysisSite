// Genre confirm/correct chip (item 1) — an ADDITIVE affordance placed next to
// an existing genre label (never replaces it). Correcting the genre POSTs to
// the BFF's per-phase rerun endpoint, which cascades server-side into phases
// 3/5/6 + a rule-engine refresh (see ReportPhaseEndpoints.RerunPhase). Shared
// by the two surfaces the PRP calls out: AnalysisCompleteModal (first-touch/
// conversion moment) and SongHeader (persistent, for revisiting a report).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  GENRE_HINT_OPTIONS,
  useConfirmGenre,
  useRerunJobStatus,
  type GenreHint,
} from '../../api/hooks';
import { fmtGenre } from './helpers/format';

interface GenreCorrectChipProps {
  jobId: string;
  genre: string | null | undefined;
}

export function GenreCorrectChip({ jobId, genre }: GenreCorrectChipProps) {
  const [open, setOpen] = useState(false);
  const [pendingRerunJobId, setPendingRerunJobId] = useState<string | undefined>();
  const confirmGenre = useConfirmGenre(jobId);
  const rerunStatus = useRerunJobStatus(pendingRerunJobId, jobId);

  useEffect(() => {
    if (!pendingRerunJobId) return;
    const status = rerunStatus.data?.status;
    if (status === 'complete') {
      toast.success('Genre corrected — score and findings updated.');
      setPendingRerunJobId(undefined);
    } else if (status === 'failed') {
      toast.error('Could not apply the genre correction. Try again.');
      setPendingRerunJobId(undefined);
    }
  }, [pendingRerunJobId, rerunStatus.data?.status]);

  const pick = (hint: GenreHint) => {
    setOpen(false);
    confirmGenre.mutate(hint, {
      onSuccess: (res) => setPendingRerunJobId(res.jobId),
      onError: () => toast.error('Could not start the genre correction. Try again.'),
    });
  };

  if (pendingRerunJobId) {
    return <span className="chip">Updating…</span>;
  }

  if (open) {
    return (
      <span className="chip-group" role="group" aria-label="Correct genre">
        {GENRE_HINT_OPTIONS.filter((g) => g !== genre).map((g) => (
          <button key={g} type="button" className="chip add" onClick={() => pick(g)}>
            {fmtGenre(g)}
          </button>
        ))}
        <button type="button" className="chip add" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="chip add"
      onClick={() => setOpen(true)}
      title="Not the right genre? Correct it here."
    >
      <span className="pl">✎</span> Correct
    </button>
  );
}
