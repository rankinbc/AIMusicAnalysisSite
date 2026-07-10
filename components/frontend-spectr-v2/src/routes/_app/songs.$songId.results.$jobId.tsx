import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { useJob, useJobResults } from '../../api/hooks';
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
          <p className={s.failFooter}>
            <Link to="/library">← Back to library</Link> and upload another version.
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
