import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import {
  useEntitlements,
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
import { ExportModal } from './ExportModal';
import { ProjectTab } from './ProjectTab';
import { ProjectUnlock } from './ProjectUnlock';
import { SendToListenCard } from './SendToListenCard';
import { ReferenceTab } from './ReferenceTab';
import { TrackInfoTab } from './TrackInfoTab';
import { DebugTab } from './DebugTab';
import { unlockIntentToInputKey } from './coach-chat-helpers';
import { buildMoves, moveToMarkdown, type Move } from './move-model';
import { ResultsTabs, type ResultsTabKey } from './ResultsTabs';
import { FixBoard } from './FixBoard';
import { useFixRackGeneration } from './useFixRackGeneration';
import { faultCount } from './problems-helpers';
import { SongHeader, type SongHeaderInputs } from './SongHeader';
import { Icon } from './Icon';
import { buildListenFixes, readListenFixes, writeListenFixes } from '../listen-rack/listenFixes';
import './redesign-v3.css';
import './redesign-v3-tabs.css';

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
  // v3: the standalone `findings` tab is dissolved into the Coach-labeled
  // "Findings" board (id `coach`) — coerce old deep-links. Debug stays dev-only.
  const tab =
    rawTab === 'findings'
      ? 'coach'
      : rawTab === 'debug' && !import.meta.env.DEV
        ? 'coach'
        : rawTab;
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
  const [committedIds, setCommittedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [committedSeeded, setCommittedSeeded] = useState(false);
  // The Listen queue is LOCAL (prototype-accurate): seeded from + persisted to
  // the per-version handoff in localStorage, NEVER the server `applied` flag.
  // Queueing must not write server state — otherwise a single bulk "Select all"
  // permanently marks every finding applied (the 78-fixes-queued footgun) and
  // re-seeds a giant queue on every load.
  useEffect(() => {
    if (committedSeeded) return;
    const stored = versionId ? readListenFixes(versionId).map((f) => f.fixId) : [];
    setCommittedIds(new Set(stored));
    setCommittedSeeded(true);
  }, [committedSeeded, versionId]);

  const toggleCommit = useCallback((move: Move) => {
    setCommittedIds((prev) => {
      const next = new Set(prev);
      if (next.has(move.id)) next.delete(move.id);
      else next.add(move.id);
      return next;
    });
  }, []);

  const navigate = useNavigate();

  // Fix-rack generation now lives inside SendToListenCard (its own
  // useFixRackGeneration instance); ReportView only owns the committed set +
  // the Game Plan export.
  const committed = useMemo(() => moves.filter((m) => committedIds.has(m.id)), [moves, committedIds]);
  // Coach Mix generation lifted here so the trigger (Coach header) and the
  // compiled preset row (Send-to-Listen) share one state machine.
  const fixRack = useFixRackGeneration(jobId);
  const [exportOpen, setExportOpen] = useState(false);
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
    // Guard on `committedSeeded` so the initial empty state can't clobber the
    // stored queue before the seed reads it back.
    if (!versionId || !committedSeeded) return;
    writeListenFixes(versionId, buildListenFixes(moves, (id) => committedIds.has(id)));
  }, [committedIds, moves, versionId, committedSeeded]);

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
    <div className="rdx" data-testid="report-view">
      <div className="wrap">
        <Link to="/songs/$songId" params={{ songId }} className="backlink">
          <Icon name="back" size={14} />
          all versions
        </Link>

        <div className="layout">
          <main className="main">
            <div className="hero-row">
              <div className="hero-left">
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
                <SendToListenCard
                  jobId={jobId}
                  versionId={versionId}
                  committedCount={committed.length}
                  fixRack={fixRack.rack}
                  onOpenGamePlan={() => setExportOpen(true)}
                />
              </div>

              <CoachTab
                jobId={jobId}
                analysisId={results.analysisId}
                trackName={trackName}
                verdicts={verdicts}
                measurementsCount={countMeasurements(fj)}
                inputs={inputs}
                committed={committed}
                coachMixReady={fixRack.rack != null}
                coachMixGenerating={fixRack.phase === 'generating'}
                onGenerateCoachMix={fixRack.generate}
                onUnlockAction={onUnlockAction}
                credits={null}
              />
            </div>

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

            {/* Findings board (the Coach-labeled first tab). */}
            {tab === 'coach' && (
              <div className="tabbody fade-up">
                <FixBoard
                  verdicts={verdicts}
                  moves={moves}
                  committedIds={committedIds}
                  onToggleCommit={toggleCommit}
                />
              </div>
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
                  Your Ableton project was attached, but its analysis hit a snag and was skipped —
                  everything else in this report is unaffected. Re-export the .als and retry to fill
                  this tab in.
                </p>
              </div>
            )}
            {tab === 'project' && !alsProject && !phase8Failed && (
              <ProjectUnlock {...(versionId ? { onUploadAls: () => setAlsDialogOpen(true) } : {})} />
            )}
            {tab === 'reference' && (
              <div className="tabbody fade-up">
                <ReferenceTab
                  genre={phase2?.genre}
                  phase6={phase6}
                  phase5={phase5}
                  phase1={phase1}
                  onGoToFindings={() => onTabChange('coach')}
                />
              </div>
            )}
            {tab === 'debug' && import.meta.env.DEV && (
              <DebugTab phases={fj.phases} rawJson={results.finalJson} />
            )}
          </main>
        </div>
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

      {exportOpen && (
        <ExportModal
          committed={committed}
          trackName={trackName}
          versionLabel={
            results.versionLabel ??
            (results.versionNumber != null ? `v${results.versionNumber}` : null)
          }
          facts={{
            bpm: phase1?.bpm,
            key: phase1?.detected_key,
            lufs: phase1?.lufs,
            genre: phase2?.genre,
          }}
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
