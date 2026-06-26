import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import { useEntitlements, useReanalyzeVersion, useVerdicts, useVersionFiles } from '../../api/hooks';
import { UpgradeSheet } from '../../components/UpgradeSheet';
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
  type Phase9Data,
} from '../../api/types';
import { AnalysisCompleteModal } from './AnalysisCompleteModal';
import { AnalysisTab } from './AnalysisTab';
import { FilesTab } from './FilesTab';
import { ProjectTab } from './ProjectTab';
import { GamePlan } from './GamePlan';
import { buildMoves } from './move-model';
import { ResultsTabs, type ResultsTabKey } from './ResultsTabs';
import { SongHeader, type SongHeaderInputs } from './SongHeader';
import s from './ReportView.module.css';

interface ReportViewProps {
  results: JobResultsDto;
  songId: string;
  /** Active tab — owned by the route's URL search params (deep-linkable). */
  tab: ResultsTabKey;
  onTabChange: (tab: ResultsTabKey) => void;
}

export function ReportView({ results, songId, tab, onTabChange }: ReportViewProps) {
  const fj: FinalJson = isFinalJson(results.finalJson) ? results.finalJson : {};
  const phase1 = pickPhaseData<Phase1Data>(fj, 1);
  const phase2 = pickPhaseData<Phase2Data>(fj, 2);
  const phase3 = pickPhaseData<Phase3Data>(fj, 3);
  const phase4 = pickPhaseData<Phase4Data>(fj, 4);
  const phase6 = pickPhaseData<Phase6Data>(fj, 6);
  const phase7 = pickPhaseData<Phase7Data>(fj, 7);
  const phase8 = pickPhaseData<Phase8Data>(fj, 8);
  const phase9 = pickPhaseData<Phase9Data>(fj, 9);

  const trackName = results.songName ?? 'Untitled';

  // Stored "project awareness" map (client-parsed .als). Drives the Project tab,
  // which only appears when a project was uploaded.
  const alsProject = results.alsProject ?? null;
  const hasProject = Boolean(alsProject);

  // Verdicts are the AI-Move source + CoachChat grounding. Shared query cache
  // with GamePlan/VerdictsPanel (keyed by jobId) — single fetch.
  const emptySetRef = useRef<ReadonlySet<string>>(new Set<string>());
  const { data: verdictsData } = useVerdicts(results.jobId, {
    enabled: true,
    optimisticRunning: emptySetRef.current,
  });
  const verdicts = useMemo(() => verdictsData?.verdicts ?? [], [verdictsData]);

  const moves = useMemo(
    () => buildMoves({ verdicts, topFixes: fj.top_fixes, coachedFixes: fj.coached_fixes }),
    [verdicts, fj.top_fixes, fj.coached_fixes],
  );

  // Which inputs the analysis ran on — drives the header chips + DepthBanner.
  const { data: filesData } = useVersionFiles(results.versionId ?? '');
  const inputs: SongHeaderInputs = useMemo(() => {
    const files = filesData?.files ?? [];
    return {
      mix: files.some((f) => f.type === 'mix') || files.length === 0,
      stems: files.some((f) => f.type === 'stem') || Boolean(phase4?.stems),
      als: files.some((f) => f.type === 'als') || Boolean(phase8),
      reference: files.some((f) => f.type === 'reference') || Boolean(phase6?.gaps),
    };
  }, [filesData, phase4, phase8, phase6]);

  const phasesDone = (fj.phases ?? []).filter((p) => p.status === 'ok').length;
  const phasesTotal = (fj.phases ?? []).length;

  // "Analysis complete" teaser modal — shown once per job.
  const seenKey = `analysisModalSeen:${results.jobId}`;
  const [showModal, setShowModal] = useState<boolean>(() => {
    try {
      return typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(seenKey);
    } catch {
      return true;
    }
  });
  const dismissModal = useCallback(() => {
    try {
      sessionStorage.setItem(seenKey, '1');
    } catch {
      /* ignore */
    }
    setShowModal(false);
  }, [seenKey]);

  // Re-analyze: fire the same actor as a fresh upload, navigate to the new job.
  const navigate = useNavigate();
  const reanalyze = useReanalyzeVersion(results.versionId ?? '');
  const ents = useEntitlements();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const dispatchReanalyze = useCallback(() => {
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
      onError: (err) => {
        // Cap hit → open the UpgradeSheet (UX-DR30) instead of a dead-end toast.
        if (err instanceof ApiError && extractApiError(err.body).code === 'entitlement_exhausted') {
          setUpgradeOpen(true);
        } else {
          toast.error(err instanceof Error ? err.message : 'Could not re-analyze');
        }
      },
    });
  }, [results.versionId, reanalyze, navigate, songId]);
  const handleReanalyze = dispatchReanalyze;

  return (
    <div className={s.report}>
      <header className={s.header}>
        <Link to="/songs/$songId" params={{ songId }} className={s.backLink}>
          ← all versions
        </Link>
      </header>

      <SongHeader
        songId={songId}
        versionId={results.versionId ?? null}
        versionLabel={null}
        trackName={trackName}
        genre={phase2?.genre}
        bpm={phase1?.bpm ?? phase2?.bpm}
        keyLabel={phase1?.detected_key}
        durationSeconds={phase1?.duration_seconds}
        inputs={inputs}
        onAddInputs={() => onTabChange('files')}
        onGetFeedback={() =>
          toast('Publishing to the feed for crowd feedback is coming soon.', { icon: '♺' })
        }
      />

      <ResultsTabs
        current={tab}
        onChange={onTabChange}
        moveCount={moves.length}
        phasesDone={phasesDone}
        phasesTotal={phasesTotal}
        hasProject={hasProject}
        projectTrackCount={alsProject?.trackCount ?? 0}
        onGamePlan={() => onTabChange('actions')}
      />

      <div className={s.tabBody}>
        {tab === 'actions' && (
          <GamePlan
            jobId={results.jobId}
            analysisId={results.analysisId}
            trackName={trackName}
            versionId={results.versionId ?? null}
            moves={moves}
            verdicts={verdicts}
            measurementsCount={countMeasurements(fj)}
            inputs={inputs}
            onAddInputs={() => onTabChange('files')}
          />
        )}
        {tab === 'analysis' && (
          <AnalysisTab
            phases={fj.phases}
            moves={moves}
            songName={trackName}
            jobId={results.jobId}
            versionId={results.versionId}
            songId={songId}
            phase1={phase1}
            phase2={phase2}
            phase3={phase3}
            phase4={phase4}
            phase6={phase6}
            phase7={phase7}
            phase8={phase8}
            phase9={phase9}
            overallScore={fj.overall_score}
            onReanalyze={handleReanalyze}
            reanalyzing={reanalyze.isPending}
          />
        )}
        {tab === 'project' && alsProject && <ProjectTab project={alsProject} />}
        {tab === 'project' && !alsProject && (
          <div className={s.noVersion}>No Ableton project was uploaded with this analysis.</div>
        )}
        {tab === 'files' && results.versionId && (
          <FilesTab
            versionId={results.versionId}
            inputs={inputs}
            onAddInputs={() => onTabChange('files')}
            onReanalyze={handleReanalyze}
            reanalyzing={reanalyze.isPending}
          />
        )}
        {tab === 'files' && !results.versionId && (
          <div className={s.noVersion}>No version attached to this analysis.</div>
        )}
      </div>

      {showModal && (
        <AnalysisCompleteModal
          fj={fj}
          songName={trackName}
          durationSec={phase1?.duration_seconds}
          genre={phase2?.genre}
          versionLabel={undefined}
          routingPlan={verdictsData?.routing_plan}
          running={null}
          onClose={dismissModal}
          onViewReport={dismissModal}
          onReanalyze={() => {
            dismissModal();
            handleReanalyze();
          }}
        />
      )}

      {/* Cap-hit upgrade moment for re-analyze (UX-DR30). No file to resume here;
          on a successful upgrade we just re-dispatch the re-analysis. */}
      <UpgradeSheet
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        analysesUsed={ents.data?.analysesUsed ?? 0}
        analysesLimit={ents.data?.analysesLimit ?? 0}
        onUpgraded={() => {
          setUpgradeOpen(false);
          dispatchReanalyze();
        }}
      />
    </div>
  );
}

function pickPhaseData<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}

/** Count of leaf-level keys across per-phase `data` objects (capped at 9999).
 *  Drives the grounding-scope line in CoachChat. */
function countMeasurements(fj: FinalJson): number {
  let count = 0;
  for (const p of fj.phases ?? []) {
    const data = p.data;
    if (!data || typeof data !== 'object') continue;
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        count += Object.keys(value as Record<string, unknown>).length;
      } else {
        count += 1;
      }
      if (count > 9999) return 9999;
    }
  }
  return count;
}
