import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import { useFreeRetry } from '../../api/hooks';
import type { FinalJson } from '../../api/types';
import { PHASE_SHORT } from './helpers/analysisModalData';
import { failedPhases } from './helpers/failed-phases';
import s from './DegradationBanner.module.css';

// Story 5.7 (FR6) — the "we kept everything that worked" banner. Renders ONLY
// when the report carries ≥1 failed phase (derived client-side from
// final_json.phases[] — works for every historical row, no server rollup).
// The retry is the entitlement-FREE lane (POST /jobs/{id}/retry) — a 409 from
// the server (already used / not eligible) hides the button; it never opens
// the UpgradeSheet, that belongs to the paid re-analyze flow.

interface DegradationBannerProps {
  fj: FinalJson;
  jobId: string;
  /** Navigate to the freshly dispatched retry job. */
  onRetryDispatched: (newJobId: string) => void;
}

export function DegradationBanner({ fj, jobId, onRetryDispatched }: DegradationBannerProps) {
  const failed = failedPhases(fj);
  const retry = useFreeRetry(jobId);
  const [retryGone, setRetryGone] = useState(false);
  // Param-only navigation between reports does NOT remount this component —
  // a 409 on job A must not hide the button for an eligible job B.
  useEffect(() => setRetryGone(false), [jobId]);

  if (failed.length === 0) return null;

  const names = failed
    .map((p) => PHASE_SHORT[p.phase] ?? `Phase ${p.phase}`)
    .join(', ');

  const dispatch = () => {
    retry.mutate(undefined, {
      onSuccess: (res) => {
        toast.success('Free retry dispatched — re-running the full analysis.');
        onRetryDispatched(res.jobId);
      },
      onError: (err) => {
        if (err instanceof ApiError) {
          const code = extractApiError(err.body).code;
          if (code === 'retry_already_used') {
            toast.info('The free retry for this analysis was already used.');
            setRetryGone(true);
            return;
          }
          if (code === 'retry_not_eligible') {
            toast.info('This report is not eligible for a free retry.');
            setRetryGone(true);
            return;
          }
        }
        toast.error(err instanceof Error ? err.message : 'Could not dispatch the retry');
      },
    });
  };

  return (
    <div className={s.banner} role="status" aria-label="Partial analysis" data-testid="degradation-banner">
      <span className={s.dot} aria-hidden="true" />
      <p className={s.message}>
        <strong>{names}</strong> hit a snag — we kept everything that worked.
        {!retryGone && ' Re-export your file and run the analysis again, free.'}
      </p>
      {!retryGone && (
        <button
          type="button"
          className="btn sm"
          onClick={dispatch}
          disabled={retry.isPending}
        >
          {retry.isPending ? 'Dispatching…' : 'Retry free'}
        </button>
      )}
    </div>
  );
}
