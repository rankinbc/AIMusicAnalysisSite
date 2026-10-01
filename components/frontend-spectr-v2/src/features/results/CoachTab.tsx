import { useMemo, useState } from 'react';

import type { VerdictDto, VerdictsListResponse } from '../../api/types';
import { CoachChat } from './CoachChat';
import { Icon } from './Icon';
import { SpecialistTeamModal } from './SpecialistTeamModal';
import type { Move } from './move-model';
import type { SongHeaderInputs } from './SongHeader';

interface CoachTabProps {
  analysisId: string;
  trackName: string;
  verdicts: VerdictDto[];
  /** The verdicts list response — owned by ReportView's useSpecialistRuns. */
  verdictsData: VerdictsListResponse | undefined;
  /** Specialist run state, lifted to ReportView (shared with the header pill). */
  runningSlugs: ReadonlySet<string>;
  ranSlugs: ReadonlySet<string>;
  onRunSpecialist: (slug: string) => Promise<void>;
  /** Specialist Team modal visibility — lifted so the header pill can open it. */
  specialistsOpen: boolean;
  onSpecialistsOpenChange: (open: boolean) => void;
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
  analysisId,
  trackName,
  verdicts,
  verdictsData,
  runningSlugs,
  ranSlugs,
  onRunSpecialist,
  specialistsOpen,
  onSpecialistsOpenChange,
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
  const [cmOpen, setCmOpen] = useState(false);
  const data = verdictsData;

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
      <button type="button" className="spec-btn" onClick={() => onSpecialistsOpenChange(true)}>
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
        triageDone={data?.routingPlan != null || data?.degradation != null}
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

      {specialistsOpen && (
        <SpecialistTeamModal
          ranSlugs={ranSlugs}
          runningSlugs={runningSlugs}
          foundBySlug={foundBySlug}
          suggestedSlugs={suggestedSlugs}
          verdicts={verdicts}
          hasStems={inputs.stems}
          credits={credits}
          onRun={onRunSpecialist}
          onClose={() => onSpecialistsOpenChange(false)}
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
