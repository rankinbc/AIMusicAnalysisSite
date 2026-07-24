import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { useRackPresets } from '../listen-rack/useRackPresets';
import { PresetChainModal } from './PresetChainModal';
import { presetRows, presetsEmptyCopy, queuedSummary, type PresetRow } from './send-to-listen-model';
import { useFixRackGeneration } from './useFixRackGeneration';
import s from './SendToListenCard.module.css';

interface Props {
  jobId: string;
  versionId: string | null;
  /** Number of committed (queued) fixes — gates Listen + the robot button. */
  committedCount: number;
  onOpenGamePlan: () => void;
}

/** "Send to Listen" — the fix-rack surface (revised design's model). Fixes are
 *  queued from the findings list; this card is a Presets list where the compiled
 *  Coach Mix appears as an `auto` preset row once generated (robot button).
 *  Every row renders its chain through the shared RackView (via PresetChainModal).
 *  One rack primitive underneath: a Coach Mix and a saved preset are the same JSON. */
export function SendToListenCard({ jobId, versionId, committedCount, onOpenGamePlan }: Props) {
  const navigate = useNavigate();
  const flow = useFixRackGeneration(jobId);
  const presetsQuery = useRackPresets(versionId ?? '');
  const userPresets = presetsQuery.data ?? [];
  const rows = presetRows(flow.rack, userPresets);
  const [open, setOpen] = useState<PresetRow | null>(null);

  const openListen = (fixPreset?: string) => {
    if (!versionId) return;
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId },
      search: fixPreset ? { fixPreset } : {},
    });
  };

  const canListen = versionId != null && (committedCount > 0 || rows.length > 0);
  const showRobot = flow.rack == null; // Coach Mix not generated yet
  const generating = flow.phase === 'generating';
  const failed = flow.phase === 'error' || flow.phase === 'timeout';

  return (
    <div className={`card ${s.card}`}>
      <div className={s.top}>
        <span className={s.title}>
          Send to Listen
          <span
            className={s.info}
            title="Queue fixes in the findings list — each carries to Listen on its own so you can A/B one change at a time. Presets (like Coach Mix) are full chains you audition as one."
            aria-hidden="true"
          >
            ⓘ
          </span>
        </span>
        <span className={s.summary}>{queuedSummary(committedCount, rows.length)}</span>
        {showRobot && !failed && (
          <button
            type="button"
            className="btn primary sm"
            onClick={flow.generate}
            disabled={committedCount === 0 || generating || flow.isPosting}
            title="Generate a Coach Mix — solve your queued fixes into one gain-staged chain, saved as a preset here."
          >
            {generating ? (
              <span className={s.robot}>
                <span className={s.spin} /> Compiling…
              </span>
            ) : (
              <span className={s.robot}>✦ Coach Mix</span>
            )}
          </button>
        )}
      </div>

      {failed && (
        <div className={s.problem}>
          <span aria-hidden="true">◴</span>
          <div className={s.problemBody}>
            {flow.phase === 'error'
              ? "Couldn't generate the Coach Mix — nothing was queued. Retry when the service is back."
              : "This is taking longer than expected — the worker hasn't produced a rack yet. Retry to queue it again."}
          </div>
          <button type="button" className="btn primary sm" onClick={flow.generate}>
            Retry
          </button>
        </div>
      )}

      <div className={s.presets}>
        {rows.length === 0 ? (
          <div className={s.empty}>
            <span aria-hidden="true">▤</span>
            {presetsEmptyCopy}
          </div>
        ) : (
          rows.map((r) => (
            <div className={s.row} key={r.key}>
              <span className={s.rowGlyph} aria-hidden="true">
                ▣
              </span>
              <button
                type="button"
                className={s.rowBtn}
                onClick={() => setOpen(r)}
                title="View devices & parameters"
              >
                <span className={s.rowName}>{r.name}</span>
                {r.auto && <span className={s.badge}>auto</span>}
                <span className={`mono ${s.count}`}>{r.moduleCount} devices</span>
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => openListen(r.presetId)}
                disabled={versionId == null}
                title={`Open ${r.name} in Listen`}
              >
                ▶ Listen
              </button>
            </div>
          ))
        )}
      </div>

      <div className={s.foot}>
        <span className={s.footNote}>
          {committedCount > 0
            ? `${committedCount} ${committedCount === 1 ? 'fix' : 'fixes'} → Listen, each A/B'd on its own`
            : 'Queue fixes to send to Listen'}
        </span>
        <button type="button" className="btn ghost sm" onClick={onOpenGamePlan}>
          ⬇ DAW Plan
        </button>
        <button
          type="button"
          className="btn primary sm"
          onClick={() => openListen()}
          disabled={!canListen}
        >
          ▶ Listen
        </button>
      </div>

      {open && (
        <PresetChainModal
          name={open.name}
          chain={open.chain}
          moduleCount={open.moduleCount}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
