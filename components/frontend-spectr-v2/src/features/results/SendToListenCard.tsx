import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import type { FixRackDto } from '../../api/types';
import { useRackPresets } from '../listen-rack/useRackPresets';
import { Icon } from './Icon';
import { PresetChainModal } from './PresetChainModal';
import { presetRows, type PresetRow } from './send-to-listen-model';

interface Props {
  jobId: string;
  versionId: string | null;
  /** Number of committed (queued) fixes — gates Listen + the footer note. */
  committedCount: number;
  /** The compiled Coach Mix (source='analysis'), lifted from ReportView so the
   *  generate trigger can live in the coach header while the preset row shows
   *  here. Null until a Coach Mix has been generated. */
  fixRack: FixRackDto | null;
  onOpenGamePlan: () => void;
}

/** "Send to Listen" (prototype `.fixcard` / FixActionBar) — the surface that
 *  carries fixes to the Listen page. Fixes are queued from the findings list;
 *  once a Coach Mix is compiled (from the coach header) it appears here as an
 *  `auto` preset row. Every row opens its full device chain through the shared
 *  RackView (via PresetChainModal) — a Coach Mix and a saved preset are one JSON. */
export function SendToListenCard({ versionId, committedCount, fixRack, onOpenGamePlan }: Props) {
  const navigate = useNavigate();
  const presetsQuery = useRackPresets(versionId ?? '');
  const userPresets = presetsQuery.data ?? [];
  const rows = presetRows(fixRack, userPresets);
  const [open, setOpen] = useState<PresetRow | null>(null);

  const openListen = (fixPreset?: string) => {
    if (!versionId) return;
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId },
      search: fixPreset ? { fixPreset } : {},
    });
  };

  const canListen = versionId != null && committedCount > 0;

  return (
    <div className="fixcard">
      <div className="fixcard-top">
        <span className="fixcard-title">
          Send to Listen
          <span className="tipwrap fc-tip">
            <Icon name="info" size={12} />
            <span className="tip up">
              Queue fixes in the findings list — each carries to <b>Listen</b> on its own so you can
              A/B one change at a time. <b>Presets</b> (like <b>Coach Mix</b>) are full chains you
              audition as one.
            </span>
          </span>
        </span>
        <span className="fc-selnote top">
          {committedCount ? (
            <>
              <span className="v">{committedCount}</span> {committedCount === 1 ? 'fix' : 'fixes'}{' '}
              queued
            </>
          ) : (
            'nothing queued'
          )}
          {rows.length > 0 && ` · ${rows.length} ${rows.length === 1 ? 'preset' : 'presets'}`}
        </span>
      </div>

      <div className="fq-presets">
        {rows.length > 0 && (
          <div className="fq-cart">
            {rows.map((r) => (
              <div className="preset-row2" key={r.key}>
                <span className="pr2-glyph">
                  <Icon name="cassette" size={13} />
                </span>
                <button
                  type="button"
                  className="pr2-b"
                  onClick={() => setOpen(r)}
                  title="View devices & parameters"
                >
                  <span className="pr2-name">{r.name}</span>
                  {r.auto && <span className="pr2-badge">auto</span>}
                  <span className="pr2-count mono">{r.moduleCount} devices</span>
                </button>
                <button
                  type="button"
                  className="pr2-listen"
                  onClick={() => openListen(r.presetId)}
                  disabled={versionId == null}
                  title={`Open ${r.name} in Listen`}
                >
                  <Icon name="play" size={11} />
                  Listen
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixcard-foot">
        {rows.length === 0 ? (
          <span className="fq-emptynote">
            <Icon name="cassette" size={12} />
            No presets yet — hit <b>Coach Mix</b> in the coach box to solve your queued fixes into one
            chain.
          </span>
        ) : (
          <span className="fc-selnote" />
        )}
        <button type="button" className="fbx-gp" onClick={onOpenGamePlan}>
          <Icon name="download" size={13} />
          DAW Plan
        </button>
        {canListen ? (
          <button type="button" className="fbx-listen" onClick={() => openListen()}>
            <Icon name="play" size={13} />
            Listen
          </button>
        ) : (
          <span className="fbx-listen disabled">
            <Icon name="play" size={13} />
            Listen
          </span>
        )}
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
