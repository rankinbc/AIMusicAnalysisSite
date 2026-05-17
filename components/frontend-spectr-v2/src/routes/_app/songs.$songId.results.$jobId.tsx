import { Link, createFileRoute } from '@tanstack/react-router';

import { useJob, useJobResults } from '../../api/hooks';
import { ReportView } from '../../features/results/ReportView';
import s from './results.module.css';

export const Route = createFileRoute('/_app/songs/$songId/results/$jobId')({
  component: ResultsPage,
});

function ResultsPage() {
  const { songId, jobId } = Route.useParams();
  const job = useJob(jobId, { pollMs: 2000 });
  const isComplete = job.data?.status === 'complete';
  const isFailed = job.data?.status === 'failed';
  const results = useJobResults(jobId, isComplete);

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

  if (isComplete && results.data) {
    return <ReportView results={results.data} songId={songId} />;
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
      {job.data && (
        <PhaseProgress
          status={job.data.status}
          phase={job.data.currentPhase}
          pct={job.data.phasePct}
        />
      )}
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

function PhaseProgress({
  status,
  phase,
  pct,
}: {
  status: string;
  phase: string;
  pct: number;
}) {
  return (
    <div className={s.panel}>
      <p className={`mono ${s.statusLine}`}>
        Status: {status}
        {phase ? ` · ${phase}` : ''}
      </p>
      <progress
        className={s.progress}
        value={Math.max(0, Math.min(1, pct))}
        max={1}
      />
    </div>
  );
}
