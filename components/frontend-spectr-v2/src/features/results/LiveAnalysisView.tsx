// The results route's view while the job is queued / running (and in the
// beat between "complete" and the report's data arriving): the analysis page
// itself, fed by the job poll. There is no separate progress screen and no
// jump — when the report loads, ReportView mounts the SAME page over it and
// the coach's conversation carries on (useLiveNarration keeps it per job).

import type { ReactNode } from 'react';

import type { JobStatusDto } from '../../api/types';
import { AnalysisCompleteModal } from './AnalysisCompleteModal';
import type { LiveInputs } from './helpers/liveRun';

interface LiveAnalysisViewProps {
  jobId: string;
  job: JobStatusDto;
  songName?: string | undefined;
  inputs?: LiveInputs | undefined;
  /** Extra dock content (e.g. a guest's demo-report link). */
  dockExtra?: ReactNode;
}

const noop = () => {};

export function LiveAnalysisView({ jobId, job, songName, inputs, dockExtra }: LiveAnalysisViewProps) {
  return (
    <AnalysisCompleteModal
      jobId={jobId}
      job={job}
      inputs={inputs}
      songName={songName}
      dockExtra={dockExtra}
      // The CTA stays disabled until ReportView takes over with the results.
      onViewReport={noop}
    />
  );
}
