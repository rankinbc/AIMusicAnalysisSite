import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import {
  useApplyVerdict,
  useEntitlements,
  useReanalyzeVersion,
  useVerdicts,
  useVersionFiles,
} from '../../api/hooks';
import { useFixRackGeneration } from './useFixRackGeneration';
import { UpgradeSheet } from '../../components/UpgradeSheet';
import {
  isFinalJson,
  type FinalJson,
  type JobResultsDto,
  type Phase1Data,
  type Phase2Data,
  type Phase3Data,
  type Phase4Data,
  type Phase5Data,
  type Phase6Data,
  type Phase8Data,
  type Phase9Data,
} from '../../api/types';
import { AlsUploadDialog } from '../../components/AlsUploadDialog';
import { ReferenceUploadDialog } from '../../components/ReferenceUploadDialog';
import { StemsUploadDialog } from '../../components/StemsUploadDialog';
import { AnalysisCompleteModal } from './AnalysisCompleteModal';
import { DegradationBanner } from './DegradationBanner';
import { LlmDegradationNotice } from './LlmDegradationNotice';
import { CoachTab } from './CoachTab';
import { CoachMixModal } from './CoachMixModal';
import { ExportModal } from './ExportModal';
import { FixModal } from './FixModal';
import { ProjectTab } from './ProjectTab';
import { ProjectUnlock } from './ProjectUnlock';
import { RackSidebar } from './RackSidebar';
import { ReferenceTab } from './ReferenceTab';
import { TrackInfoTab } from './TrackInfoTab';
import { DebugTab } from './DebugTab';
import { unlockIntentToInputKey } from './coach-chat-helpers';
import { buildMoves, moveToMarkdown, type Move } from './move-model';
import { ResultsTabs, type ResultsTabKey } from './ResultsTabs';
import { FindingsTab } from './FindingsTab';
import { faultCount } from './problems-helpers';
import { SongHeader, type SongHeaderInputs } from './SongHeader';
import { buildListenFixes, writeListenFixes } from '../listen-rack/listenFixes';
import './redesign.css';
import s from './ReportView.module.css';

interface ReportViewProps {
  results: JobResultsDto;
  songId: string;
  /** Active tab — owned by the route's URL search params (deep-linkable). */
  tab: ResultsTabKey;
  onTabChange: (tab: ResultsTabKey) => void;
}

export function ReportView({ results, songId, tab: rawTab, onTabChange }: ReportViewProps) {
  // Story 12.5 review: 'debug' stays a valid deep-link KEY (dev builds), but a
  // prod user hitting ?tab=debug must not land on a blank pane with no tab
  // highlighted — coerce to the default tab outside DEV.
  const tab = rawTab === 'debug' && !import.meta.env.DEV ? 'coach' : rawTab;
  const fj: FinalJson = isFinalJson(results.finalJson) ? results.finalJson : {};
  const phase1 = pickPhaseData<Phase1Data>(fj, 1);
  const phase2 = pickPhaseData<Phase2Data>(fj, 2);
  const phase3 = pickPhaseData<Phase3Data>(fj, 3);
  const phase4 = pickPhaseData<Phase4Data>(fj, 4);
  const phase5 = pickPhaseData<Phase5Data>(fj, 5);
  const phase6 = pickPhaseData<Phase6Data>(fj, 6);
  const phase8 = pickPhaseData<Phase8Data>(fj, 8);
  const phase9 = pickPhaseData<Phase9Data>(fj, 9);

  const trackName = results.songName ?? 'Untitled';
  const jobId = results.jobId;
  const versionId = results.versionId ?? null;

  const alsProject = results.alsProject ?? null;
  const hasProject = Boolean(alsProject);
  // Story 5.7 (AC3): phase 8 ran (an .als existed) but failed/was sandboxed
  // out — drives the Project-tab skip note when no client-parsed map exists.
  const phase8Failed = fj.phases?.find((p) => p.phase === 8)?.status === 'failed';
  // The Reference tab shows when EITHER a genre placement exists (phase 6) OR an
  // uploaded reference was compared (phase 5) — the tab renders both sections by
  // per-metric availability.
  const hasReference =
    Boolean(phase6?.gaps && Object.keys(phase6.gaps).length > 0) || phase5?.status === 'ok';

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
      reference:
        files.some((f) => f.type === 'reference') ||
        Boolean(phase6?.gaps) ||
        phase5?.status === 'ok',
    };
  }, [filesData, phase4, phase8, phase6, phase5]);

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

  // ── Fix Rack (né "Coach Mix", story 12.6) — generation lifecycle is shared
  // between the coach header button and the sidebar panel via one hook, which
  // also owns the error/timeout failure paths. ──
  const {
    phase: fixRackPhase,
    rack: fixRackData,
    generate: generateCoachMix,
  } = useFixRackGeneration(jobId);
  // error/timeout map to 'idle' here so the header button reverts to
  // "Generate Fix Rack"; the detailed error UI lives in the panel/modal.
  const coachMixState: 'idle' | 'generating' | 'ready' = fixRackData
    ? 'ready'
    : fixRackPhase === 'generating'
      ? 'generating'
      : 'idle';

  // Fix Rack + Game Plan open in modals (the sidebar carries compact entries).
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

  // Listen handoff — persist the user's Added + applyable fixes for the Listen
  // "Plan" tab. Only fixes whose dsp_chain maps to a rack module are written;
  // prose fixes belong to the DAW game plan. Producer side only.
  useEffect(() => {
    if (!versionId) return;
    writeListenFixes(versionId, buildListenFixes(moves, (id) => committedIds.has(id)));
  }, [committedIds, moves, versionId]);

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

  // Story 12.5: the add-input chips (and the coach unlock chips) open the REAL
  // upload dialogs — no more "go to the song page" toast.
  const [stemsDialogOpen, setStemsDialogOpen] = useState(false);
  const [alsDialogOpen, setAlsDialogOpen] = useState(false);
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
  const onAddInputs = useCallback((key?: keyof SongHeaderInputs) => {
    if (key === 'reference') { setReferenceDialogOpen(true); return; }
    if (key === 'als') {
      if (versionId) setAlsDialogOpen(true);
      else toast.error('No version attached — cannot upload a project.');
      return;
    }
    if (key === 'mix') {
      // A new mix is a new VERSION — that flow lives on the song page.
      void navigate({ to: '/songs/$songId', params: { songId } });
      return;
    }
    // key === 'stems' or undefined (generic "add files" affordances): stems is
    // the most common depth gap — a DELIBERATE default, not a fall-through.
    if (versionId) setStemsDialogOpen(true);
    else toast.error('No version attached — cannot upload stems.');
  }, [versionId, songId, navigate]);
  const onUnlockAction = useCallback((intent: 'add_stems' | 'add_reference') => {
    onAddInputs(unlockIntentToInputKey(intent));
  }, [onAddInputs]);

  return (
    <div className={`${s.report} rdx`} data-testid="report-view">
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
            jobId={jobId}
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

          <DegradationBanner
            fj={fj}
            jobId={jobId}
            onRetryDispatched={(newJobId) =>
              void navigate({
                to: '/songs/$songId/results/$jobId',
                params: { songId, jobId: newJobId },
              })
            }
          />

          {/* Wave 2 (FR16/UX-DR17) — LLM-degradation notice, independent of the
              phase-failure banner above; both may render at once. */}
          {verdictsData?.degradation && (
            <LlmDegradationNotice notice={verdictsData.degradation} />
          )}

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
                onUnlockAction={onUnlockAction}
                onGenerateCoachMix={generateCoachMix}
                coachMixState={coachMixState}
                credits={null}
              />
            )}
            {tab === 'findings' && (
              <FindingsTab
                verdicts={verdicts}
                onGoToActions={() => onTabChange('coach')}
                onTrackActivate={() => onTabChange('project')}
              />
            )}
            {tab === 'project' && alsProject && (
              <ProjectTab project={alsProject} phase8={phase8} phase8Failed={phase8Failed} />
            )}
            {/* Story 5.7 (AC3): an .als WAS attached but phase 8 died in its
                sandbox (timeout/crash/parse error) — say so instead of showing
                the misleading "unlock with a project upload" CTA. */}
            {tab === 'project' && !alsProject && phase8Failed && (
              <div className="card" data-testid="project-skip-note">
                <p className="label">Project analysis skipped this run</p>
                <p>
                  Your Ableton project was attached, but its analysis hit a snag and was
                  skipped — everything else in this report is unaffected. Re-export the
                  .als and retry to fill this tab in.
                </p>
              </div>
            )}
            {tab === 'project' && !alsProject && !phase8Failed && (
              <ProjectUnlock {...(versionId ? { onUploadAls: () => setAlsDialogOpen(true) } : {})} />
            )}
            {tab === 'reference' && (
              <ReferenceTab
                genre={phase2?.genre}
                phase6={phase6}
                phase5={phase5}
                phase1={phase1}
                onGoToFindings={() => onTabChange('findings')}
              />
            )}
            {tab === 'trackinfo' && (
              <TrackInfoTab
                phase1={phase1}
                phase2={phase2}
                phase3={phase3}
                phase4={phase4}
                phase9={phase9}
                danceability={fj.danceability_score}
                spectrogramUrl={results.spectrogramImageUrl}
                waveformUrl={results.waveformImageUrl}
              />
            )}
            {tab === 'debug' && import.meta.env.DEV && (
              <DebugTab phases={fj.phases} rawJson={results.finalJson} />
            )}
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

      {versionId && (
        <StemsUploadDialog
          open={stemsDialogOpen}
          onOpenChange={setStemsDialogOpen}
          versionId={versionId}
          songId={songId}
        />
      )}
      {versionId && (
        <AlsUploadDialog
          open={alsDialogOpen}
          onOpenChange={setAlsDialogOpen}
          versionId={versionId}
          songId={songId}
        />
      )}
      <ReferenceUploadDialog
        open={referenceDialogOpen}
        onOpenChange={setReferenceDialogOpen}
        {...(phase2?.genre ? { defaultGenre: phase2.genre } : {})}
        onUploaded={(title) =>
          // Honest next step (story 12.5 review): a library reference does NOT
          // retroactively attach to THIS analysis — comparison needs a re-run.
          toast.info(`“${title}” is in your reference library — re-analyze this version to compare against it.`)
        }
      />

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
          genPhase={fixRackPhase}
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
          jobId={jobId}
          songName={trackName}
          durationSec={phase1?.duration_seconds}
          genre={phase2?.genre}
          versionLabel={undefined}
          routingPlan={verdictsData?.routingPlan}
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
