import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import {
  useApplyVerdict,
  useEntitlements,
  useFixRack,
  useGenerateFixRack,
  useReanalyzeVersion,
  useVerdicts,
  useVersionFiles,
} from '../../api/hooks';
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
  type Phase8Data,
  type Phase9Data,
} from '../../api/types';
import { AnalysisCompleteModal } from './AnalysisCompleteModal';
import { CoachTab } from './CoachTab';
import { CoachMixModal } from './CoachMixModal';
import { ExportModal } from './ExportModal';
import { FixModal } from './FixModal';
import { ProjectTab } from './ProjectTab';
import { RackSidebar } from './RackSidebar';
import { ReferenceTab } from './ReferenceTab';
import { TrackInfoTab } from './TrackInfoTab';
import { DebugTab } from './DebugTab';
import { buildMoves, moveToMarkdown, type Move } from './move-model';
import { ResultsTabs, type ResultsTabKey } from './ResultsTabs';
import { FindingsTab } from './FindingsTab';
import { faultCount } from './problems-helpers';
import { SongHeader, type SongHeaderInputs } from './SongHeader';
import './redesign.css';
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
  const phase8 = pickPhaseData<Phase8Data>(fj, 8);
  const phase9 = pickPhaseData<Phase9Data>(fj, 9);

  const trackName = results.songName ?? 'Untitled';
  const jobId = results.jobId;
  const versionId = results.versionId ?? null;

  const alsProject = results.alsProject ?? null;
  const hasProject = Boolean(alsProject);
  const hasReference = Boolean(phase6?.gaps && Object.keys(phase6.gaps).length > 0);

  // Verdicts are the AI-Move source + CoachChat grounding. Shared query cache
  // (keyed by jobId) — single fetch.
  const emptySetRef = useRef<ReadonlySet<string>>(new Set<string>());
  const { data: verdictsData } = useVerdicts(jobId, {
    enabled: true,
    optimisticRunning: emptySetRef.current,
  });
  const verdicts = useMemo(() => verdictsData?.verdicts ?? [], [verdictsData]);

  const moves = useMemo(
    () => buildMoves({ verdicts, topFixes: fj.top_fixes, coachedFixes: fj.coached_fixes }),
    [verdicts, fj.top_fixes, fj.coached_fixes],
  );

  // Which inputs the analysis ran on — drives the header chips.
  const { data: filesData } = useVersionFiles(versionId ?? '');
  const inputs: SongHeaderInputs = useMemo(() => {
    const files = filesData?.files ?? [];
    return {
      mix: files.some((f) => f.type === 'mix') || files.length === 0,
      stems: files.some((f) => f.type === 'stem') || Boolean(phase4?.stems),
      als: files.some((f) => f.type === 'als') || Boolean(phase8),
      reference: files.some((f) => f.type === 'reference') || Boolean(phase6?.gaps),
    };
  }, [filesData, phase4, phase8, phase6]);

  // ── Committed ("Added to Listen") moves — lifted here so both the Coach tab
  // (move toggles) and the sidebar (Fixes for Listen queue) stay in sync. ──
  const apply = useApplyVerdict(jobId);
  const [committedIds, setCommittedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [committedSeeded, setCommittedSeeded] = useState(false);
  useEffect(() => {
    if (committedSeeded || moves.length === 0) return;
    const seed = new Set<string>();
    for (const m of moves) if (m.status === 'committed') seed.add(m.id);
    setCommittedIds(seed);
    setCommittedSeeded(true);
  }, [moves, committedSeeded]);

  const toggleCommit = useCallback(
    (move: Move) => {
      setCommittedIds((prev) => {
        const next = new Set(prev);
        if (next.has(move.id)) {
          next.delete(move.id);
        } else {
          next.add(move.id);
          if (move.verdictId) {
            apply.mutate(move.verdictId, {
              onError: () => {
                /* local commit still stands; persistence is best-effort */
              },
            });
          }
        }
        return next;
      });
    },
    [apply],
  );

  const navigate = useNavigate();
  const audition = useCallback(() => {
    if (!versionId) {
      toast.error('No version attached — open Listen from the song page.');
      return;
    }
    void navigate({ to: '/listen-rack/$versionId', params: { versionId } });
  }, [navigate, versionId]);

  // ── Coach Mix (fix rack) — generation flag is shared between the coach
  // header button and the sidebar panel. ──
  const qc = useQueryClient();
  const genFixRack = useGenerateFixRack(jobId);
  const [coachMixRequested, setCoachMixRequested] = useState(false);
  const fixRack = useFixRack(jobId, coachMixRequested);
  const generateCoachMix = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['fix-rack', jobId] });
    setCoachMixRequested(true);
    genFixRack.mutate();
  }, [qc, genFixRack, jobId]);
  const coachMixState: 'idle' | 'generating' | 'ready' = fixRack.data
    ? 'ready'
    : coachMixRequested
      ? 'generating'
      : 'idle';

  // Coach Mix + Game Plan open in modals (the sidebar carries compact entries).
  const committed = useMemo(() => moves.filter((m) => committedIds.has(m.id)), [moves, committedIds]);
  const [coachMixOpen, setCoachMixOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fixModalMove, setFixModalMove] = useState<Move | null>(null);
  const downloadGamePlan = useCallback(() => {
    const md = moveToMarkdown(committed, trackName);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(trackName || 'game-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game-plan'}-game-plan.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [committed, trackName]);

  // Listen handoff — persist the selected fixes for the Listen page to pick up.
  // Producer side only; no DSP here.
  useEffect(() => {
    if (!versionId) return;
    const sel = moves.filter((m) => committedIds.has(m.id));
    const handoff = {
      versionId,
      jobId,
      selectedFixes: sel.map((m) => ({
        fixId: m.id,
        verdictId: m.verdictId,
        label: m.title,
        scope: m.scope,
        specialist: m.specialist,
        // The DSP ops the fix compiles to — what the Listen rack applies.
        dsp: m.steps.map((st) => ({ type: st.where, detail: st.detail })),
      })),
      savedAt: new Date().toISOString(),
    };
    try {
      sessionStorage.setItem(`coachMix:${versionId}`, JSON.stringify(handoff));
    } catch {
      /* ignore */
    }
  }, [committedIds, moves, versionId, jobId]);

  // "Analysis complete" teaser modal — shown once per job.
  const seenKey = `analysisModalSeen:${jobId}`;
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
  const reanalyze = useReanalyzeVersion(versionId ?? '');
  const ents = useEntitlements();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const dispatchReanalyze = useCallback(() => {
    if (!versionId) {
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
        if (err instanceof ApiError && extractApiError(err.body).code === 'entitlement_exhausted') {
          setUpgradeOpen(true);
        } else {
          toast.error(err instanceof Error ? err.message : 'Could not re-analyze');
        }
      },
    });
  }, [versionId, reanalyze, navigate, songId]);
  const handleReanalyze = dispatchReanalyze;

  const onAddInputs = useCallback(() => {
    toast('Add stems, your .als, or a reference from the song page to deepen the analysis.', {
      icon: '＋',
    });
  }, []);

  return (
    <div className={`${s.report} rdx`}>
      <header className={s.header}>
        <Link to="/songs/$songId" params={{ songId }} className={s.backLink}>
          ← all versions
        </Link>
      </header>

      <div className="layout">
        <main className="main">
          <SongHeader
            songId={songId}
            versionId={versionId}
            versionLabel={
              results.versionLabel ??
              (results.versionNumber != null ? `v${results.versionNumber}` : null)
            }
            trackName={trackName}
            genre={phase2?.genre}
            durationSeconds={phase1?.duration_seconds}
            inputs={inputs}
            findingCount={faultCount(verdicts)}
            suggestionCount={moves.length}
            onAddInputs={onAddInputs}
          />

          <ResultsTabs
            current={tab}
            onChange={onTabChange}
            findingCount={faultCount(verdicts)}
            hasProject={hasProject}
            projectTrackCount={alsProject?.trackCount ?? 0}
            hasReference={hasReference}
          />

          <div className={s.tabBody}>
            {tab === 'coach' && (
              <CoachTab
                jobId={jobId}
                analysisId={results.analysisId}
                trackName={trackName}
                moves={moves}
                verdicts={verdicts}
                measurementsCount={countMeasurements(fj)}
                inputs={inputs}
                committedIds={committedIds}
                onToggleCommit={toggleCommit}
                onAddInputs={onAddInputs}
                onGenerateCoachMix={generateCoachMix}
                coachMixState={coachMixState}
                credits={null}
              />
            )}
            {tab === 'findings' && (
              <FindingsTab verdicts={verdicts} onGoToActions={() => onTabChange('coach')} />
            )}
            {tab === 'project' && alsProject && <ProjectTab project={alsProject} phase8={phase8} />}
            {tab === 'project' && !alsProject && (
              <div className={s.noVersion}>No Ableton project was uploaded with this analysis.</div>
            )}
            {tab === 'reference' && (
              <ReferenceTab genre={phase2?.genre} score={fj.overall_score} phase6={phase6} />
            )}
            {tab === 'trackinfo' && (
              <TrackInfoTab
                phase1={phase1}
                phase2={phase2}
                phase3={phase3}
                phase4={phase4}
                phase9={phase9}
                spectrogramUrl={results.spectrogramImageUrl}
                waveformUrl={results.waveformImageUrl}
              />
            )}
            {tab === 'debug' && <DebugTab phases={fj.phases} rawJson={results.finalJson} />}
          </div>
        </main>

        <RackSidebar
          versionId={versionId}
          moves={moves}
          committedIds={committedIds}
          onRemove={toggleCommit}
          onOpenFix={setFixModalMove}
          onAudition={audition}
          coachMixState={coachMixState}
          onOpenCoachMix={() => setCoachMixOpen(true)}
          onOpenGamePlan={() => setExportOpen(true)}
        />
      </div>

      {fixModalMove && (
        <FixModal
          move={fixModalMove}
          onRemove={toggleCommit}
          onClose={() => setFixModalMove(null)}
        />
      )}

      {coachMixOpen && (
        <CoachMixModal
          jobId={jobId}
          versionId={versionId}
          trackName={trackName}
          committedCount={committed.length}
          requested={coachMixRequested}
          onGenerate={generateCoachMix}
          onClose={() => setCoachMixOpen(false)}
        />
      )}

      {exportOpen && (
        <ExportModal
          committed={committed}
          trackName={trackName}
          onClose={() => setExportOpen(false)}
          onDownload={() => {
            downloadGamePlan();
            setExportOpen(false);
          }}
        />
      )}

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
