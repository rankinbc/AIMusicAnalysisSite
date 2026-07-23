import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import { useFreeRetry, useJob, useJobResults } from '../../api/hooks';
import { capture } from '../../lib/analytics';
import { setCorrelation } from '../../lib/sentry';
import { ProgressStoryline } from '../../features/results/ProgressStoryline';
import { ReportView } from '../../features/results/ReportView';
import {
  DEFAULT_RESULTS_TAB,
  isResultsTabKey,
  type ResultsTabKey,
} from '../../features/results/results-tab-keys';
import s from './results.module.css';

interface ResultsSearch {
  // Optional so the many existing navigations to this route (upload dialogs,
  // listen/reports/song-detail links) don't need to pass a tab. Absent ⇒ the
  // AI Coach tab. `?tab=findings` / `?tab=trackinfo` / etc. deep-link the rest.
  tab?: ResultsTabKey;
}

export const Route = createFileRoute('/_app/songs/$songId/results/$jobId')({
  validateSearch: (search: Record<string, unknown>): ResultsSearch =>
    isResultsTabKey(search.tab) ? { tab: search.tab } : {},
  component: ResultsPage,
});

function ResultsPage() {
  const { songId, jobId } = Route.useParams();
  const { tab } = Route.useSearch();
  const activeTab: ResultsTabKey = tab ?? DEFAULT_RESULTS_TAB;
  const navigate = Route.useNavigate();
  const setTab = (next: ResultsTabKey) =>
    void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true });

  const job = useJob(jobId, { pollMs: 2000 });
  const isComplete = job.data?.status === 'complete';
  const isFailed = job.data?.status === 'failed';
  const results = useJobResults(jobId, isComplete);

  // Story 5.7 (FR6): failed-job free retry. The server owns eligibility —
  // a 409 (not eligible / already used) just hides the button.
  const retry = useFreeRetry(jobId);
  const [retryGone, setRetryGone] = useState(false);
  // Param-only navigation keeps this component mounted — reset per job.
  useEffect(() => setRetryGone(false), [jobId]);
  const dispatchFreeRetry = () =>
    retry.mutate(undefined, {
      onSuccess: (res) => {
        toast.success('Free retry dispatched.');
        void navigate({
          to: '/songs/$songId/results/$jobId',
          params: { songId, jobId: res.jobId },
        });
      },
      onError: (err) => {
        if (err instanceof ApiError) {
          const code = extractApiError(err.body).code;
          if (code === 'retry_already_used' || code === 'retry_not_eligible') {
            toast.info(
              code === 'retry_already_used'
                ? 'The free retry for this analysis was already used.'
                : 'This run is not eligible for a free retry.',
            );
            setRetryGone(true);
            return;
          }
        }
        toast.error(err instanceof Error ? err.message : 'Could not dispatch the retry');
      },
    });

  // Story 10.3 (NFR30): frontend joins the correlation chain — render errors
  // on this page carry the job id; report_viewed pairs with job timestamps
  // for the time-to-first-insight KPI.
  useEffect(() => {
    setCorrelation(jobId);
    return () => setCorrelation(null);
  }, [jobId]);
  const viewCaptured = useRef<string | null>(null);
  useEffect(() => {
    // Once per job per mount-session — remounts/StrictMode must not inflate
    // the TTFI denominator.
    if (isComplete && viewCaptured.current !== jobId) {
      viewCaptured.current = jobId;
      capture('report_viewed', { job_id: jobId });
    }
  }, [isComplete, jobId]);

  if (job.error) {
    return (
      <FrameWithBack songId={songId}>
        <p className={s.loadError}>
          Failed to load job status:{' '}
          {job.error instanceof Error ? job.error.message : String(job.error)}
        </p>
      </FrameWithBack>
    );
  }

  if (isComplete) {
    if (results.data) {
      return <ReportView results={results.data} songId={songId} tab={activeTab} onTabChange={setTab} />;
    }
    // Job is done — never fall through to the in-progress storyline (its
    // elapsed clock and "taking longer" hint would misread a finished job).
    return (
      <FrameWithBack songId={songId}>
        {results.error ? (
          <p className={s.loadError}>
            Analysis finished, but the report failed to load:{' '}
            {results.error instanceof Error ? results.error.message : String(results.error)}
          </p>
        ) : (
          <p className="mono">Loading report…</p>
        )}
      </FrameWithBack>
    );
  }

  if (isFailed && job.data) {
    return (
      <FrameWithBack songId={songId}>
        <div className={s.failPanel}>
          <p className={s.failTitle}>Analysis failed.</p>
          {job.data.errorMessage && (
            <pre className={s.failMessage}>{job.data.errorMessage}</pre>
          )}
          {/* Story 5.7 (FR6): a failed run earns one entitlement-free retry —
              eligibility is server-decided (409 hides the button). */}
          {!retryGone && (
            <p>
              <button
                type="button"
                className="btn sm"
                onClick={dispatchFreeRetry}
                disabled={retry.isPending}
              >
                {retry.isPending ? 'Dispatching…' : 'Retry free'}
              </button>
            </p>
          )}
          <p className={s.failFooter}>
            <Link to="/library">← Back to library</Link> and upload another version.
          </p>
        </div>
      </FrameWithBack>
    );
  }

  // E5.6: awaiting_stem_mapping never resolves on its own — the stems review on
  // the song page owns the next step. Honest copy instead of an eternal spinner
  // (the useJob poll already treats this status as terminal).
  if (job.data?.status === 'awaiting_stem_mapping') {
    return (
      <FrameWithBack songId={songId}>
        <div className={s.failPanel}>
          <p className={s.failTitle}>Waiting on stem role confirmation.</p>
          <p>
            This analysis starts after you finish the stems review — confirm the
            detected roles from the song page.
          </p>
          <p className={s.failFooter}>
            <Link to="/songs/$songId" params={{ songId }}>
              Go to the song page →
            </Link>
          </p>
        </div>
      </FrameWithBack>
    );
  }

  return (
    <FrameWithBack songId={songId}>
      <h1 className={s.heading}>Analysis in progress</h1>
      {job.data && <ProgressStoryline job={job.data} />}
    </FrameWithBack>
  );
}

function FrameWithBack({ songId, children }: { songId: string; children: React.ReactNode }) {
  return (
    <div className={s.frame}>
      <Link to="/songs/$songId" params={{ songId }} className={s.backLink}>
        ← all versions
      </Link>
      {children}
    </div>
  );
}
