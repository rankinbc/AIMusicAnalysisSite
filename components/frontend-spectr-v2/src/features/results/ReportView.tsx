import { useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';

import { useVerdicts } from '../../api/hooks';
import {
  isFinalJson,
  type FinalJson,
  type JobResultsDto,
  type Phase1Data,
  type Phase2Data,
} from '../../api/types';
import { AnalysisTab } from './AnalysisTab';
import { ArrangementTab } from './ArrangementTab';
import { CoachChat } from './CoachChat';
import { ReferenceTab } from './ReferenceTab';
import { ResultsTabs, type ResultsTabKey } from './ResultsTabs';
import { SpectrumTab } from './SpectrumTab';
import { VerdictHero } from './VerdictHero';
import { VerdictsPanel } from './VerdictsPanel';
import s from './ReportView.module.css';

interface ReportViewProps {
  results: JobResultsDto;
  songId: string;
}

export function ReportView({ results, songId }: ReportViewProps) {
  const fj: FinalJson = isFinalJson(results.finalJson) ? results.finalJson : {};
  const phase1 = pickPhaseData<Phase1Data>(fj, 1);
  const phase2 = pickPhaseData<Phase2Data>(fj, 2);

  const [tab, setTab] = useState<ResultsTabKey>('coach');

  // Pull verdicts here too so the tab badge reflects live count without
  // mounting VerdictsPanel on tabs other than `coach`. Polling is owned by
  // VerdictsPanel itself, so we pass an empty optimistic set.
  const emptySetRef = useRef<ReadonlySet<string>>(new Set<string>());
  const { data: verdictsData } = useVerdicts(results.jobId, {
    enabled: true,
    optimisticRunning: emptySetRef.current,
  });

  const coachCount = useMemo(
    () =>
      (verdictsData?.verdicts ?? []).filter(
        (v) => !v.userState.dismissed && !v.userState.applied,
      ).length,
    [verdictsData],
  );

  const phasesDone = (fj.phases ?? []).filter((p) => p.status === 'ok').length;
  const phasesTotal = (fj.phases ?? []).length;

  return (
    <div className={s.report}>
      <header className={s.header}>
        <Link to="/songs/$songId" params={{ songId }} className={s.backLink}>
          ← all versions
        </Link>
        <span className={s.backLink} style={{ marginLeft: 'auto' }}>
          {results.songName ?? 'Untitled'}
        </span>
      </header>

      <VerdictHero
        trackName={results.songName ?? 'Untitled'}
        grade={fj.grade ?? null}
        score={fj.overall_score}
        danceability={fj.danceability_score}
        phase1={phase1}
        phase2={phase2}
      />

      <ResultsTabs
        current={tab}
        onChange={setTab}
        coachCount={coachCount}
        phasesDone={phasesDone}
        phasesTotal={phasesTotal}
        referenceOutOfRange={1}
        arrangementFlag
      />

      <div className={s.tabBody}>
        {tab === 'coach' && (
          <div className={s.coachStack}>
            <CoachChat trackName={results.songName ?? ''} />
            <VerdictsPanel jobId={results.jobId} hasStems={false} />
          </div>
        )}
        {tab === 'analysis' && (
          <AnalysisTab phases={fj.phases} songName={results.songName ?? 'master.wav'} />
        )}
        {tab === 'spectrum' && <SpectrumTab bands={phase1?.bands} />}
        {tab === 'reference' && (
          <ReferenceTab genre={phase2?.genre} score={fj.overall_score} />
        )}
        {tab === 'arrangement' && <ArrangementTab />}
      </div>
    </div>
  );
}

function pickPhaseData<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}
