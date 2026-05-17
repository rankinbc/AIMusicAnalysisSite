import { useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { useReanalyzeVersion, useVerdicts } from '../../api/hooks';
import {
  isFinalJson,
  type FinalJson,
  type JobResultsDto,
  type Phase1Data,
  type Phase2Data,
  type Phase3Data,
  type Phase4Data,
  type Phase6Data,
  type Phase7Data,
  type Phase8Data,
} from '../../api/types';
import { AnalysisTab } from './AnalysisTab';
import { ArrangementTab } from './ArrangementTab';
import { CoachChat } from './CoachChat';
import { SPECIALIST_CATALOG } from './helpers/specialists';
import { ReferenceTab } from './ReferenceTab';
import { ResultsTabs, type ResultsTabKey } from './ResultsTabs';
import { SpectrumTab } from './SpectrumTab';
import { VerdictHero } from './VerdictHero';
import { VerdictsPanel } from './VerdictsPanel';
import s from './ReportView.module.css';

const SPECIALIST_CATALOG_SIZE = SPECIALIST_CATALOG.length;

interface ReportViewProps {
  results: JobResultsDto;
  songId: string;
}

export function ReportView({ results, songId }: ReportViewProps) {
  const fj: FinalJson = isFinalJson(results.finalJson) ? results.finalJson : {};
  const phase1 = pickPhaseData<Phase1Data>(fj, 1);
  const phase2 = pickPhaseData<Phase2Data>(fj, 2);
  const phase3 = pickPhaseData<Phase3Data>(fj, 3);
  const phase4 = pickPhaseData<Phase4Data>(fj, 4);
  const phase6 = pickPhaseData<Phase6Data>(fj, 6);
  const phase7 = pickPhaseData<Phase7Data>(fj, 7);
  const phase8 = pickPhaseData<Phase8Data>(fj, 8);

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

  // Tab denominator matches the curated Analysis-tab pipeline: worker phases
  // + 4 virtual rows (AI specialists, stems, reference, .als).
  const workerOk = (fj.phases ?? []).filter((p) => p.status === 'ok').length;
  const specialistsCached = (verdictsData?.specialists ?? []).filter(
    (sp) => sp.status === 'cached' || sp.status === 'failed',
  ).length;
  const allSpecialistsRun =
    specialistsCached > 0 && specialistsCached >= SPECIALIST_CATALOG_SIZE;
  const phasesDone = workerOk + (allSpecialistsRun ? 1 : 0);
  const phasesTotal = (fj.phases ?? []).length + 4;

  // Re-analyze: fire the same dramatiq actor as a fresh upload and navigate
  // to the new job's results page. The current report stays mounted until
  // navigation completes (no flash of stale data).
  const navigate = useNavigate();
  const reanalyze = useReanalyzeVersion(results.versionId ?? '');
  const handleReanalyze = useCallback(() => {
    if (!results.versionId) {
      toast.error('This analysis is not tied to a version — cannot re-analyze.');
      return;
    }
    reanalyze.mutate(undefined, {
      onSuccess: (res) => {
        toast.success('Re-analysis dispatched.');
        void navigate({
          to: '/songs/$songId/results/$jobId',
          params: { songId, jobId: res.jobId },
        });
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Could not re-analyze'),
    });
  }, [results.versionId, reanalyze, navigate, songId]);

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
        referenceOutOfRange={
          phase6?.gaps
            ? Object.values(phase6.gaps).filter((g) => !g.in_range).length
            : 0
        }
        arrangementFlag={(phase7?.issues?.length ?? 0) > 0}
        onReanalyze={handleReanalyze}
        reanalyzing={reanalyze.isPending}
      />

      <div className={s.tabBody}>
        {tab === 'coach' && (
          <div className={s.coachStack}>
            <CoachChat trackName={results.songName ?? ''} />
            <VerdictsPanel jobId={results.jobId} hasStems={false} />
          </div>
        )}
        {tab === 'analysis' && (
          <AnalysisTab
            phases={fj.phases}
            songName={results.songName ?? 'master.wav'}
            jobId={results.jobId}
            coachName={fj.coach_name}
            coachIntro={fj.coach_intro}
            coachedFixes={fj.coached_fixes}
            phase8={phase8}
            onReanalyze={handleReanalyze}
            reanalyzing={reanalyze.isPending}
          />
        )}
        {tab === 'spectrum' && (
          <SpectrumTab
            bands={phase1?.bands}
            phase1={phase1}
            phase3={phase3}
            phase4={phase4}
          />
        )}
        {tab === 'reference' && (
          <ReferenceTab
            genre={phase2?.genre}
            score={fj.overall_score}
            phase6={phase6}
          />
        )}
        {tab === 'arrangement' && <ArrangementTab phase7={phase7} />}
      </div>
    </div>
  );
}

function pickPhaseData<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}
