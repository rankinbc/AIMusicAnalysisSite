import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useApplyVerdict,
  useDismissVerdict,
  useFeedbackVerdict,
  useRunSpecialist,
  useVerdicts,
} from '../../api/hooks';
import type { FeedbackKind, SpecialistStatusKind } from '../../api/types';
import { CoachFilters, type CoachFilterKey } from './CoachFilters';
import {
  SPECIALIST_CATALOG,
  SPECIALIST_GROUPS,
  specialistGroup,
  type SpecialistGroup,
} from './helpers/specialists';
import { SpecialistTile } from './SpecialistTile';
import { VerdictCard } from './VerdictCard';
import s from './VerdictsPanel.module.css';

interface VerdictsPanelProps {
  jobId: string;
  hasStems: boolean;
}

export function VerdictsPanel({ jobId, hasStems }: VerdictsPanelProps) {
  const [optimisticRunning, setOptimisticRunning] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [filter, setFilter] = useState<CoachFilterKey>('all');
  const [showFixed, setShowFixed] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(true);

  const { data, isLoading } = useVerdicts(jobId, {
    optimisticRunning,
    enabled: true,
  });
  const run = useRunSpecialist(jobId);
  const dismiss = useDismissVerdict(jobId);
  const apply = useApplyVerdict(jobId);
  const feedback = useFeedbackVerdict(jobId);

  // Drop slugs from optimistic-running once the BFF reports a terminal state.
  useMemo(() => {
    if (!data) return;
    const stillRunning = new Set<string>();
    for (const slug of optimisticRunning) {
      const serverStatus = data.specialists.find((sp) => sp.slug === slug)?.status;
      if (serverStatus === 'idle') stillRunning.add(slug);
    }
    if (stillRunning.size !== optimisticRunning.size) {
      setOptimisticRunning(stillRunning);
    }
  }, [data, optimisticRunning]);

  const tileStatus = useCallback(
    (slug: string): SpecialistStatusKind => {
      if (optimisticRunning.has(slug)) return 'running';
      const sv = data?.specialists.find((sp) => sp.slug === slug)?.status;
      return sv ?? 'idle';
    },
    [data, optimisticRunning],
  );

  const findingsBySlug = useMemo(() => {
    const out = new Map<string, number>();
    for (const v of data?.verdicts ?? []) {
      if (v.userState.dismissed) continue;
      out.set(v.specialist, (out.get(v.specialist) ?? 0) + 1);
    }
    return out;
  }, [data]);

  const handleRun = useCallback(
    async (slug: string) => {
      const next = new Set(optimisticRunning);
      next.add(slug);
      setOptimisticRunning(next);
      try {
        await run.mutateAsync(slug);
      } catch (err) {
        const after = new Set(optimisticRunning);
        after.delete(slug);
        setOptimisticRunning(after);
        toast.error(err instanceof Error ? err.message : 'Could not start specialist');
      }
    },
    [optimisticRunning, run],
  );

  const handleDismiss = useCallback(
    (id: string) => {
      dismiss.mutate(id, {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not dismiss verdict'),
      });
    },
    [dismiss],
  );

  const handleApply = useCallback(
    (id: string) => {
      apply.mutate(id, {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not mark applied'),
      });
    },
    [apply],
  );

  const handleFeedback = useCallback(
    (id: string, fb: FeedbackKind) => {
      feedback.mutate(
        { verdictId: id, feedback: fb },
        {
          onSuccess: () => toast.success('Feedback recorded'),
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : 'Could not send feedback'),
        },
      );
    },
    [feedback],
  );

  const verdicts = useMemo(() => data?.verdicts ?? [], [data?.verdicts]);
  const visibleVerdicts = useMemo(() => {
    return verdicts.filter((v) => {
      if (!showFixed && (v.userState.applied || v.userState.dismissed)) return false;
      if (filter === 'all') return true;
      return specialistGroup(v.specialist) === filter;
    });
  }, [verdicts, filter, showFixed]);

  const totalSpecialists = SPECIALIST_CATALOG.length;
  const runCount = (data?.specialists ?? []).filter(
    (sp) => sp.status === 'cached' || sp.status === 'failed',
  ).length;
  const runningCount = optimisticRunning.size;

  return (
    <div>
      <CoachFilters
        verdicts={verdicts}
        active={filter}
        onActive={setFilter}
        showFixed={showFixed}
        onShowFixedChange={setShowFixed}
      />

      {isLoading && <p className={s.loading}>Loading verdicts…</p>}

      {visibleVerdicts.length > 0 && (
        <div className={s.verdicts}>
          {visibleVerdicts.map((v, i) => (
            <VerdictCard
              key={v.id}
              verdict={v}
              rank={i + 1}
              onDismiss={handleDismiss}
              onApply={handleApply}
              onFeedback={handleFeedback}
            />
          ))}
        </div>
      )}

      {!isLoading && verdicts.length === 0 && (
        <p className={s.empty}>
          Click a specialist below to run it. Verdicts will appear here as they finish.
        </p>
      )}

      <section className={s.roster}>
        <button
          type="button"
          className={s.rosterHd}
          onClick={() => setRosterOpen((v) => !v)}
          aria-expanded={rosterOpen}
        >
          <span className={s.rosterTitle}>
            All {totalSpecialists} specialists
            <span
              className={`${s.rosterStats}${runCount > 0 ? ` ${s.rosterStatsActive}` : ''}`}
            >
              · {runCount} RUN{runningCount > 0 && ` · ${runningCount} RUNNING`}
            </span>
          </span>
          <span
            className={s.rosterChevron}
            style={{ transform: rosterOpen ? 'rotate(0)' : 'rotate(-90deg)' }}
          >
            ▾
          </span>
        </button>
        {rosterOpen && (
          <div className={s.rosterBody}>
            {SPECIALIST_GROUPS.map((g) => (
              <SpecialistGroupSection
                key={g}
                group={g}
                hasStems={hasStems}
                tileStatus={tileStatus}
                findingsBySlug={findingsBySlug}
                onRun={handleRun}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface SpecialistGroupSectionProps {
  group: SpecialistGroup;
  hasStems: boolean;
  tileStatus: (slug: string) => SpecialistStatusKind;
  findingsBySlug: Map<string, number>;
  onRun: (slug: string) => void;
}

function SpecialistGroupSection({
  group,
  hasStems,
  tileStatus,
  findingsBySlug,
  onRun,
}: SpecialistGroupSectionProps) {
  const items = SPECIALIST_CATALOG.filter((m) => m.group === group);
  if (items.length === 0) return null;
  return (
    <div className={s.groupSection}>
      <div className={s.groupLabel}>{group}</div>
      <div className={s.grid}>
        {items.map((m) => (
          <SpecialistTile
            key={m.slug}
            slug={m.slug}
            label={m.label}
            group={group}
            status={tileStatus(m.slug)}
            findings={findingsBySlug.get(m.slug) ?? 0}
            disabled={Boolean(m.needsStems) && !hasStems}
            onRun={onRun}
          />
        ))}
      </div>
    </div>
  );
}
