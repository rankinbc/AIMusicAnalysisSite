import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useRunSpecialist, useVerdicts } from '../../api/hooks';
import type { VerdictDto } from '../../api/types';
import { CoachChat } from './CoachChat';
import { DepthBanner } from './DepthBanner';
import { MoveCard } from './MoveCard';
import { SPECIALIST_CATALOG } from './helpers/specialists';
import { splitRouting } from './helpers/analysisModalData';
import { SpecialistTeamModal } from './SpecialistTeamModal';
import { TriagePlanPanel } from './TriagePlanPanel';
import { MOVE_SEV_RANK, type Move } from './move-model';
import type { SongHeaderInputs } from './SongHeader';

interface CoachTabProps {
  jobId: string;
  analysisId: string;
  trackName: string;
  moves: Move[];
  verdicts: VerdictDto[];
  measurementsCount: number;
  inputs: SongHeaderInputs;
  /** The committed ("Added to Listen") move ids — owned by ReportView. */
  committedIds: ReadonlySet<string>;
  onToggleCommit: (move: Move) => void;
  onAddInputs: () => void;
  /** Story 12.5: unlock chips open the REAL upload dialogs (owned by ReportView). */
  onUnlockAction?: (intent: 'add_stems' | 'add_reference') => void;
  onGenerateCoachMix: () => void;
  coachMixState: 'idle' | 'generating' | 'ready';
  credits: number | null;
}

export function CoachTab({
  jobId,
  analysisId,
  trackName,
  moves,
  verdicts,
  measurementsCount,
  inputs,
  committedIds,
  onToggleCommit,
  onAddInputs,
  onUnlockAction,
  onGenerateCoachMix,
  coachMixState,
  credits,
}: CoachTabProps) {
  const [optimisticRunning, setOptimisticRunning] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [specOpen, setSpecOpen] = useState(false);

  const { data } = useVerdicts(jobId, { optimisticRunning, enabled: true });
  const run = useRunSpecialist(jobId);

  // Drop slugs from optimistic-running once their verdict lands.
  useEffect(() => {
    if (!data) return;
    const ran = new Set(data.specialists.filter((sp) => sp.status !== 'idle').map((sp) => sp.slug));
    setOptimisticRunning((prev) => {
      const next = new Set<string>();
      for (const slug of prev) if (!ran.has(slug)) next.add(slug);
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  const ranSlugs = useMemo(
    () => new Set((data?.specialists ?? []).filter((sp) => sp.status !== 'idle').map((sp) => sp.slug)),
    [data],
  );

  const foundBySlug = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of verdicts) {
      if (v.headline === 'Specialist failed') continue;
      m.set(v.specialist, (m.get(v.specialist) ?? 0) + 1);
    }
    return m;
  }, [verdicts]);

  const suggestedCount = data?.routing_plan?.specialists_to_run?.length ?? 0;

  // Surface the triage plan on the report itself (the completion modal may be
  // retired). Pending = triage hasn't written a plan and hasn't degraded.
  const routing = useMemo(() => splitRouting(data?.routing_plan), [data]);
  const triagePending = data != null && data.routing_plan == null && data.degradation == null;

  const handleRun = useCallback(
    async (slug: string) => {
      setOptimisticRunning((prev) => new Set(prev).add(slug));
      try {
        await run.mutateAsync(slug);
      } catch (err) {
        setOptimisticRunning((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
        toast.error(err instanceof Error ? err.message : 'Could not start specialist');
      }
    },
    [run],
  );

  // Auto-run the Triage-suggested specialists on the initial view so the
  // rack-backed suggested fixes actually appear (Triage already budgeted the
  // set via estimated_total_tokens). Fires once per analysis, only when no AI
  // verdict has landed yet, and skips stem-only specialists without stems.
  const autoRanRef = useRef<string | null>(null);
  const autoRunSpecialist = useCallback(
    (slug: string) => {
      setOptimisticRunning((prev) => new Set(prev).add(slug));
      void run.mutateAsync(slug).catch(() => {
        // Silent — a 409 ("already has a verdict") or transient failure just
        // drops the slug back out of the running set.
        setOptimisticRunning((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
      });
    },
    [run],
  );
  useEffect(() => {
    const plan = data?.routing_plan;
    if (!plan || autoRanRef.current === analysisId) return;
    autoRanRef.current = analysisId;
    if (verdicts.some((v) => v.source === 'llm_identifier')) return; // already have AI fixes
    const already = new Set(
      (data?.specialists ?? []).filter((sp) => sp.status !== 'idle').map((sp) => sp.slug),
    );
    for (const entry of plan.specialists_to_run) {
      const meta = SPECIALIST_CATALOG.find((s) => s.slug === entry.name);
      if (already.has(entry.name)) continue;
      if (meta?.needsStems && !inputs.stems) continue;
      autoRunSpecialist(entry.name);
    }
  }, [data, analysisId, verdicts, inputs.stems, autoRunSpecialist]);

  const queued = moves.filter((m) => committedIds.has(m.id)).length;
  const shallow = !inputs.stems && !inputs.als;

  const sortedMoves = useMemo(
    () =>
      [...moves].sort(
        (a, b) => MOVE_SEV_RANK[b.sev] - MOVE_SEV_RANK[a.sev] || b.confidence - a.confidence,
      ),
    [moves],
  );

  const renderMove = (m: Move) => (
    <MoveCard
      key={m.id}
      move={{ ...m, status: committedIds.has(m.id) ? 'committed' : m.status }}
      onToggleCommit={onToggleCommit}
    />
  );

  const mixDisabled = queued === 0 || coachMixState === 'generating';

  return (
    <div>
      <CoachChat
        trackName={trackName}
        analysisId={analysisId}
        verdicts={verdicts}
        measurementsCount={measurementsCount}
        {...(onUnlockAction ? { onUnlockAction } : {})}
        headerActions={
          <>
            <button type="button" className="spec-btn" onClick={() => setSpecOpen(true)}>
              <span aria-hidden>✦</span> Specialist Team
              <span className="mono sb-counts">
                <span className="cnt">{ranSlugs.size} run</span>
                {suggestedCount > 0 && <span className="cnt sug">{suggestedCount} suggested</span>}
              </span>
            </button>
            <button
              type="button"
              className={`genmix-btn${coachMixState === 'ready' ? ' ready' : ''}`}
              onClick={onGenerateCoachMix}
              disabled={mixDisabled}
            >
              {coachMixState === 'generating'
                ? 'Compiling…'
                : coachMixState === 'ready'
                  ? '↻ Regenerate Fix Rack'
                  : '▣ Generate Fix Rack'}
            </button>
          </>
        }
      />

      {shallow && (
        <DepthBanner missing={{ stems: !inputs.stems, als: !inputs.als }} onAddInputs={onAddInputs} />
      )}

      <TriagePlanPanel
        routing={routing}
        triagePending={triagePending}
        ranSlugs={ranSlugs}
        runningSlugs={optimisticRunning}
        hasStems={inputs.stems}
        onRun={(slug) => void handleRun(slug)}
        onOpenTeam={() => setSpecOpen(true)}
      />

      <div className="seclabel">
        <span className="t">Recommended fixes</span>
        <span className="hint">
          {moves.length} {moves.length === 1 ? 'fix' : 'fixes'}
          {queued > 0 && ` · ${queued} queued for Listen`}
        </span>
        <span className="rule" />
      </div>

      {moves.length === 0 ? (
        <div className="empty-state">
          <div className="es-ic violet" aria-hidden>
            ✦
          </div>
          <div className="es-t">No one-click fixes for this track</div>
          <div className="es-s">
            See Findings for the full picture, or ask the Coach to dig into a specific area.
          </div>
        </div>
      ) : (
        sortedMoves.map(renderMove)
      )}

      {specOpen && (
        <SpecialistTeamModal
          ranSlugs={ranSlugs}
          runningSlugs={optimisticRunning}
          foundBySlug={foundBySlug}
          hasStems={inputs.stems}
          credits={credits}
          onRun={handleRun}
          onClose={() => setSpecOpen(false)}
        />
      )}
    </div>
  );
}
