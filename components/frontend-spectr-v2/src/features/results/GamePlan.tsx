import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { useApplyVerdict, useRunSpecialist, useVerdicts } from '../../api/hooks';
import type { VerdictDto } from '../../api/types';
import { CoachChat } from './CoachChat';
import { DeepenZone } from './DeepenZone';
import { DepthBanner } from './DepthBanner';
import { ExportBar } from './ExportBar';
import { MoveCard } from './MoveCard';
import { VerdictsPanel } from './VerdictsPanel';
import { groupMoves, isCleanMix, type Move } from './move-model';
import type { SongHeaderInputs } from './SongHeader';
import s from './GamePlan.module.css';

interface GamePlanProps {
  jobId: string;
  analysisId: string;
  trackName: string;
  versionId: string | null;
  /** Pre-built moves (rule-engine + AI), owned by ReportView. */
  moves: Move[];
  /** Verdicts feeding CoachChat grounding (shared with ReportView). */
  verdicts: VerdictDto[];
  measurementsCount: number;
  inputs: SongHeaderInputs;
  onAddInputs: () => void;
}

export function GamePlan({
  jobId,
  analysisId,
  trackName,
  versionId,
  moves,
  verdicts,
  measurementsCount,
  inputs,
  onAddInputs,
}: GamePlanProps) {
  const navigate = useNavigate();
  const [optimisticRunning, setOptimisticRunning] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [committedIds, setCommittedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [committedSeeded, setCommittedSeeded] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);

  // Routing plan + specialist run-state come from the shared verdicts query;
  // the move list itself is built upstream in ReportView and passed in.
  const { data } = useVerdicts(jobId, { optimisticRunning, enabled: true });
  const run = useRunSpecialist(jobId);
  const apply = useApplyVerdict(jobId);

  // Seed committed-set once from server state (verdicts marked applied), then
  // let local toggles drive it (apply is best-effort persisted; un-commit is
  // local-only since there's no un-apply endpoint).
  useEffect(() => {
    if (committedSeeded || moves.length === 0) return;
    const seed = new Set<string>();
    for (const m of moves) if (m.status === 'committed') seed.add(m.id);
    setCommittedIds(seed);
    setCommittedSeeded(true);
  }, [moves, committedSeeded]);

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

  const audition = useCallback(() => {
    if (!versionId) {
      toast.error('No version attached — open Listen from the song page.');
      return;
    }
    void navigate({ to: '/listen/$versionId', params: { versionId } });
  }, [navigate, versionId]);

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

  const { quick, deep } = groupMoves(moves);
  const clean = isCleanMix(moves);
  const committed = useMemo(() => moves.filter((m) => committedIds.has(m.id)), [moves, committedIds]);
  const shallow = !inputs.stems && !inputs.als;

  const renderMove = (m: Move) => (
    <MoveCard key={m.id} move={{ ...m, status: committedIds.has(m.id) ? 'committed' : m.status }} onToggleCommit={toggleCommit} onAudition={audition} />
  );

  return (
    <div className={s.plan}>
      <div className={s.coach}>
        <CoachChat
          trackName={trackName}
          analysisId={analysisId}
          verdicts={verdicts}
          measurementsCount={measurementsCount}
        />
      </div>

      {shallow && <DepthBanner missing={{ stems: !inputs.stems, als: !inputs.als }} onAddInputs={onAddInputs} />}

      {moves.length === 0 ? (
        <p className={s.empty}>
          No moves yet — the plan fills in as analysis phases complete and you run specialists below.
        </p>
      ) : clean ? (
        <section className={s.group}>
          <h2 className={s.groupLabel}>
            <span aria-hidden>✓</span> Clean mix — here's the polish
            <span className={s.count}>{moves.length}</span>
          </h2>
          {moves.map(renderMove)}
        </section>
      ) : (
        <>
          {quick.length > 0 && (
            <section className={s.group}>
              <h2 className={s.groupLabel}>
                <span aria-hidden>⚡</span> Quick wins
                <span className={s.count}>{quick.length}</span>
                <span className={s.hint}>do these first</span>
              </h2>
              {quick.map(renderMove)}
            </section>
          )}
          {deep.length > 0 && (
            <section className={s.group}>
              <h2 className={s.groupLabel}>
                <span aria-hidden>🛠</span> Deeper work
                <span className={s.count}>{deep.length}</span>
                <span className={s.hint}>more effort</span>
              </h2>
              {deep.map(renderMove)}
            </section>
          )}
        </>
      )}

      <DeepenZone
        routingPlan={data?.routing_plan}
        ranSlugs={ranSlugs}
        runningSlugs={optimisticRunning}
        onRun={handleRun}
        onBrowseAll={() => setRosterOpen((v) => !v)}
      />

      {rosterOpen && (
        <div className={s.roster}>
          <VerdictsPanel jobId={jobId} hasStems={inputs.stems} />
        </div>
      )}

      <ExportBar committed={committed} trackName={trackName} />
    </div>
  );
}
