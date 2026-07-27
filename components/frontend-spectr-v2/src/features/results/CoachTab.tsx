import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useRunSpecialist, useVerdicts } from '../../api/hooks';
import type { VerdictDto } from '../../api/types';
import { CoachChat } from './CoachChat';
import { Icon } from './Icon';
import { SPECIALIST_CATALOG } from './helpers/specialists';
import { SpecialistTeamModal } from './SpecialistTeamModal';
import type { Move } from './move-model';
import type { SongHeaderInputs } from './SongHeader';

interface CoachTabProps {
  jobId: string;
  analysisId: string;
  trackName: string;
  verdicts: VerdictDto[];
  measurementsCount: number;
  inputs: SongHeaderInputs;
  /** Committed ("queued for Listen") moves — the Coach Mix confirm modal lists
   *  them, and their count gates the Coach Mix button. */
  committed: Move[];
  /** Coach Mix generation lifecycle — lifted to ReportView so the trigger can
   *  live in this header while the compiled preset shows in Send-to-Listen. */
  coachMixReady: boolean;
  coachMixGenerating: boolean;
  onGenerateCoachMix: () => void;
  /** Story 12.5: unlock chips open the REAL upload dialogs (owned by ReportView). */
  onUnlockAction?: (intent: 'add_stems' | 'add_reference') => void;
  credits: number | null;
  /** v4 "Ask the coach about this" — threaded down to CoachChat. */
  askSeed?: { text: string; nonce: number } | null;
}

/** The hero-row Coach card (prototype `.coach-wrap`): grounded chat + the two
 *  header actions (Coach Mix confirm, Specialist Team). The recommended-fixes
 *  list moved to the Findings board — this card is chat-only now. */
export function CoachTab({
  jobId,
  analysisId,
  trackName,
  verdicts,
  measurementsCount,
  inputs,
  committed,
  coachMixReady,
  coachMixGenerating,
  onGenerateCoachMix,
  onUnlockAction,
  credits,
  askSeed,
}: CoachTabProps) {
  const [optimisticRunning, setOptimisticRunning] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [specOpen, setSpecOpen] = useState(false);
  const [cmOpen, setCmOpen] = useState(false);

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

  const suggestedCount = data?.routingPlan?.specialistsToRun?.length ?? 0;
  const suggestedSlugs = useMemo(
    () => new Set((data?.routingPlan?.specialistsToRun ?? []).map((e) => e.name)),
    [data],
  );

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
  // rack-backed suggested fixes actually appear. Fires once per analysis, only
  // when no AI verdict has landed yet, and skips stem-only specialists.
  const autoRanRef = useRef<string | null>(null);
  const autoRunSpecialist = useCallback(
    (slug: string) => {
      setOptimisticRunning((prev) => new Set(prev).add(slug));
      void run.mutateAsync(slug).catch(() => {
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
    const plan = data?.routingPlan;
    if (!plan || autoRanRef.current === analysisId) return;
    autoRanRef.current = analysisId;
    if (verdicts.some((v) => v.source === 'llm_identifier')) return; // already have AI fixes
    const already = new Set(
      (data?.specialists ?? []).filter((sp) => sp.status !== 'idle').map((sp) => sp.slug),
    );
    for (const entry of plan.specialistsToRun) {
      const meta = SPECIALIST_CATALOG.find((s) => s.slug === entry.name);
      if (already.has(entry.name)) continue;
      if (meta?.needsStems && !inputs.stems) continue;
      autoRunSpecialist(entry.name);
    }
  }, [data, analysisId, verdicts, inputs.stems, autoRunSpecialist]);

  const fixCount = committed.length;

  const greeting = (
    <>
      I&rsquo;ve been through <b>{trackName || 'this track'}</b> top to bottom — every measured metric
      and specialist verdict. Ask me anything, or start with the findings below.
    </>
  );

  const headerActions = (
    <>
      {!coachMixReady && (
        <button
          type="button"
          className="spec-btn cmix"
          disabled={coachMixGenerating || fixCount === 0}
          onClick={() => setCmOpen(true)}
        >
          {coachMixGenerating ? <span className="cmg-spin" /> : <Icon name="cassette" size={13} />}
          {coachMixGenerating ? 'Compiling…' : 'Coach Mix'}
        </button>
      )}
      <button type="button" className="spec-btn" onClick={() => setSpecOpen(true)}>
        <Icon name="robot" size={13} />
        Specialists
      </button>
    </>
  );

  return (
    <>
      <CoachChat
        trackName={trackName}
        analysisId={analysisId}
        verdicts={verdicts}
        measurementsCount={measurementsCount}
        headerActions={headerActions}
        specialistsRan={ranSlugs.size}
        specialistsSuggested={suggestedCount}
        greeting={greeting}
        {...(onUnlockAction ? { onUnlockAction } : {})}
        askSeed={askSeed ?? null}
      />

      {cmOpen && (
        <CoachMixConfirmModal
          queued={committed}
          onCreate={() => {
            setCmOpen(false);
            onGenerateCoachMix();
          }}
          onClose={() => setCmOpen(false)}
        />
      )}

      {specOpen && (
        <SpecialistTeamModal
          ranSlugs={ranSlugs}
          runningSlugs={optimisticRunning}
          foundBySlug={foundBySlug}
          suggestedSlugs={suggestedSlugs}
          verdicts={verdicts}
          hasStems={inputs.stems}
          credits={credits}
          onRun={handleRun}
          onClose={() => setSpecOpen(false)}
        />
      )}
    </>
  );
}

// ── Coach Mix confirm — what it's about to do + create ──
function CoachMixConfirmModal({
  queued,
  onCreate,
  onClose,
}: {
  queued: Move[];
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ width: 'min(480px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Coach Mix"
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">Coach Mix</div>
            <div className="mn">Solve your fixes into one chain</div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p className="tab-intro" style={{ margin: '0 0 12px' }}>
            The coach takes your {queued.length} queued {queued.length === 1 ? 'fix' : 'fixes'}, orders
            them into one gain-staged device chain, and saves it as a preset in <b>Send to Listen</b> —
            audition the whole mix at once instead of one fix at a time.
          </p>
          <div className="cmc-list">
            {queued.map((m, i) => (
              <div className="cmc-row" key={m.id}>
                <span className="n mono">{i + 1}</span>
                <span className="t">{m.title}</span>
                <span className="devs mono">
                  {m.steps.length > 0 ? m.steps.map((st) => st.where).join(' → ') : 'directional'}
                </span>
              </div>
            ))}
          </div>
          <p className="cmc-note">
            Changing your queued fixes later invalidates the mix — just regenerate it.
          </p>
        </div>
        <div className="spec-foot">
          <span className="sf-note">
            <span className="v">{queued.length}</span> {queued.length === 1 ? 'fix' : 'fixes'} → 1 preset
          </span>
          <button type="button" className="btn primary sm" onClick={onCreate}>
            <Icon name="bolt" size={13} />
            Create preset · 1 cr
          </button>
        </div>
      </div>
    </div>
  );
}
