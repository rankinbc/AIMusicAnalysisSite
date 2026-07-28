import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import type { FixRackDto, VerdictDto } from '../../api/types';
import { useRackPresets } from '../listen-rack/useRackPresets';
import { buildListenFixes, writeListenFixes } from '../listen-rack/listenFixes';
import { Icon } from './Icon';
import type { Move } from './move-model';
import { presetRows, type PresetRow } from './send-to-listen-model';
import {
  genreTargets,
  manualNotes,
  perDeviceGroups,
  timestampedMoments,
} from './improvement-plan-model';
import { mmss } from './feedback-timeline-model';
import { priorityTip } from './fix-board-helpers';

// Improvement Plan tab (v4, key `dawplan`). Two sections:
//   §1 Listen in Studio — checkable Active-fixes column + single-select preset
//      column (the rack applies ONE chain; device-scoped presets are NOT
//      offered — recorded product decision). Picks travel via the existing
//      listenFixes localStorage contract + ?fixPreset= carry-over.
//   §2 Create DAW Plan — by-move (priority-sorted, P-chips) and per-device
//      (Master first) views, timestamped moments, genre targets, manual notes,
//      real export via the ExportModal.

interface ImprovementPlanTabProps {
  versionId: string | null;
  verdicts: VerdictDto[];
  moves: Move[];
  committedIds: ReadonlySet<string>;
  checkedNoteIds: ReadonlySet<string>;
  fixRack: FixRackDto | null;
  specialistsRan: number;
  specialistsSuggested: number;
  onOpenExport: () => void;
  onShowFinding: (verdictId: string) => void;
  onLogPlan: (kind: 'listen_in_studio' | 'export', label: string) => void;
}

export function ImprovementPlanTab({
  versionId,
  verdicts,
  moves,
  committedIds,
  checkedNoteIds,
  fixRack,
  specialistsRan,
  specialistsSuggested,
  onOpenExport,
  onShowFinding,
  onLogPlan,
}: ImprovementPlanTabProps) {
  const navigate = useNavigate();
  const presetsQuery = useRackPresets(versionId ?? '');
  const committed = useMemo(() => moves.filter((m) => committedIds.has(m.id)), [moves, committedIds]);

  // §1 picks: default = everything queued; preset = at most one.
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set());
  const [pickedPreset, setPickedPreset] = useState<string | null>(null);
  const picks = committed.filter((m) => !unpicked.has(m.id));
  const rows = presetRows(fixRack, presetsQuery.data ?? []);

  const togglePick = (id: string) =>
    setUnpicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openStudio = () => {
    if (!versionId || (picks.length === 0 && !pickedPreset)) return;
    // Same store the Actions queue writes — picks travel by construction.
    writeListenFixes(versionId, buildListenFixes(picks, (id) => picks.some((p) => p.id === id)));
    onLogPlan(
      'listen_in_studio',
      `Listen in Studio — ${picks.length} fix${picks.length === 1 ? '' : 'es'}${pickedPreset ? ' + preset' : ''}`,
    );
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId },
      search: pickedPreset ? { fixPreset: pickedPreset } : {},
    });
  };

  const committedVerdictIds = useMemo(
    () => new Set(committed.map((m) => m.verdictId).filter((id): id is string => id != null)),
    [committed],
  );
  const byMove = useMemo(() => [...committed].sort((a, b) => b.impact - a.impact), [committed]);
  const devices = useMemo(() => perDeviceGroups(committed), [committed]);
  const moments = useMemo(() => timestampedMoments(verdicts), [verdicts]);
  const targets = useMemo(
    () => genreTargets(verdicts, committedVerdictIds),
    [verdicts, committedVerdictIds],
  );
  const notes = useMemo(() => manualNotes(verdicts, checkedNoteIds), [verdicts, checkedNoteIds]);
  const verdictById = useMemo(() => new Map(verdicts.map((v) => [v.id, v])), [verdicts]);
  const [view, setView] = useState<'move' | 'device'>('move');
  const [rationaleOpen, setRationaleOpen] = useState(false);

  return (
    <div className="ip-stack">
      {/* ── §1 Listen in Studio ── */}
      <div className="card ip-card">
        <div className="card-hd">
          <span className="t">
            <span className="led" />
            Listen in Studio
          </span>
          <span className="meta">audition your picks on the Listen rack</span>
        </div>
        <div className="ip-cols">
          <div className="ip-col">
            <span className="fbd-rackhd">Active fixes ({picks.length}/{committed.length})</span>
            {committed.length === 0 && (
              <p className="fbd-dataexp">Queue fixes from Findings or Actions first.</p>
            )}
            {committed.map((m) => {
              const on = !unpicked.has(m.id);
              const v = m.verdictId ? verdictById.get(m.verdictId) : undefined;
              return (
                <button
                  type="button"
                  key={m.id}
                  className={`ip-pick${on ? ' on' : ''}`}
                  onClick={() => togglePick(m.id)}
                >
                  <span className="ck">{on && <Icon name="check" size={11} />}</span>
                  <span className="t">{m.title}</span>
                  {v && (
                    <span className="mchip pr gloss">
                      P{v.priorityScore}
                      <span className="gtip">{priorityTip(v)}</span>
                    </span>
                  )}
                  <span className="fx-scope mono">{m.scope || 'Master'}</span>
                </button>
              );
            })}
          </div>
          <div className="ip-col">
            <span className="fbd-rackhd">Presets (pick one)</span>
            {rows.length === 0 && (
              <p className="fbd-dataexp">
                No presets yet — Coach Mix compiles your queue into one chain.
              </p>
            )}
            {rows.map((r) => (
              <PresetPickRow
                key={r.key}
                row={r}
                picked={pickedPreset === (r.presetId ?? null) && pickedPreset != null}
                onPick={() =>
                  setPickedPreset((cur) => (cur === r.presetId ? null : (r.presetId ?? null)))
                }
                rationale={
                  r.auto && fixRack?.coachMeta
                    ? { meta: fixRack.coachMeta, open: rationaleOpen, toggle: () => setRationaleOpen((o) => !o) }
                    : null
                }
              />
            ))}
          </div>
        </div>
        <div className="ip-foot">
          <span className="fbd-dataexp" style={{ margin: 0 }}>
            Fixes A/B one at a time; a preset loads as one full chain. Device-scoped moves stay in
            the DAW plan below.
          </span>
          <button
            type="button"
            className="fbd-goact"
            disabled={!versionId || (picks.length === 0 && !pickedPreset)}
            onClick={openStudio}
          >
            <Icon name="play" size={12} />
            Listen in Studio ({picks.length + (pickedPreset ? 1 : 0)})
          </button>
        </div>
      </div>

      {/* ── §2 Create DAW Plan ── */}
      <div className="card ip-card">
        <div className="card-hd">
          <span className="t">
            <span className="led" />
            Create DAW Plan
          </span>
          <span className="meta">
            {specialistsRan} specialists ran · {specialistsSuggested} suggested · {verdicts.length}{' '}
            findings · {committed.length}/{moves.length} fixes selected
          </span>
        </div>

        <div className="fbd-subtabs" style={{ margin: '0 14px' }}>
          <button type="button" className={view === 'move' ? 'on' : ''} onClick={() => setView('move')}>
            By move
          </button>
          <button
            type="button"
            className={view === 'device' ? 'on' : ''}
            onClick={() => setView('device')}
          >
            Per device
          </button>
        </div>

        <div className="ip-plan">
          {committed.length === 0 ? (
            <p className="fbd-dataexp">Select fixes on the Actions tab to build the plan.</p>
          ) : view === 'move' ? (
            byMove.map((m) => {
              const v = m.verdictId ? verdictById.get(m.verdictId) : undefined;
              return (
                <div className="ip-move" key={m.id}>
                  <span className="mchip pr gloss">
                    P{v?.priorityScore ?? m.impact}
                    {v && <span className="gtip">{priorityTip(v)}</span>}
                  </span>
                  <div className="b">
                    <span className="t">{m.title}</span>
                    <span className="d">{m.directive}</span>
                  </div>
                  <span className="fx-scope mono">{m.scope || 'Master'}</span>
                </div>
              );
            })
          ) : (
            devices.map((g) => (
              <div className="ip-device" key={g.device}>
                <div className="ip-device-hd mono">
                  {g.device === 'Master' ? 'Master' : `Device: ${g.device}`}
                </div>
                {g.moves.map((m) => {
                  const v = m.verdictId ? verdictById.get(m.verdictId) : undefined;
                  return (
                    <div className="ip-move" key={m.id}>
                      <span className="mchip pr gloss">
                        P{v?.priorityScore ?? m.impact}
                        {v && <span className="gtip">{priorityTip(v)}</span>}
                      </span>
                      <div className="b">
                        <span className="t">{m.title}</span>
                        <span className="d">{m.directive}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {moments.length > 0 && (
            <div className="ip-sec">
              <span className="fbd-rackhd">Timestamped moments</span>
              {moments.map((m) => (
                <button
                  type="button"
                  key={m.verdictId}
                  className="ip-moment"
                  onClick={() => onShowFinding(m.verdictId)}
                >
                  <span className="mono t">{mmss(m.t)}</span>
                  <span className="l">{m.label}</span>
                  <span className="h">{m.headline}</span>
                </button>
              ))}
            </div>
          )}

          {targets.length > 0 && (
            <div className="ip-sec">
              <span className="fbd-rackhd">Genre targets</span>
              <div className="evrows">
                <div className="er hd">
                  <span>Metric</span>
                  <span>Yours</span>
                  <span>Target</span>
                  <span />
                </div>
                {targets.map((t, i) => (
                  <div className="er" key={i}>
                    <span className="m mono">{t.metric}</span>
                    <span className="y mono">{t.yours}</span>
                    <span className="e mono">{t.target}</span>
                    <span />
                  </div>
                ))}
              </div>
            </div>
          )}

          {notes.length > 0 && (
            <div className="ip-sec">
              <span className="fbd-rackhd">Manual notes</span>
              <p className="fbd-dataexp">
                No one-click fix — work these by hand:{' '}
                {notes.map((n, i) => (
                  <span key={n.id}>
                    {i > 0 && ' · '}
                    <button type="button" className="addr-lnk" onClick={() => onShowFinding(n.id)}>
                      {n.headline}
                    </button>
                  </span>
                ))}
              </p>
            </div>
          )}
        </div>

        <div className="ip-foot">
          <span />
          <button
            type="button"
            className="fbd-goact"
            disabled={committed.length === 0}
            onClick={() => {
              if (committed.length === 0) {
                toast.info('Select fixes first — the plan exports your selection.');
                return;
              }
              onLogPlan('export', 'Opened DAW plan export');
              onOpenExport();
            }}
          >
            <Icon name="download" size={12} />
            Export DAW Plan
          </button>
        </div>
      </div>
    </div>
  );
}

function PresetPickRow({
  row,
  picked,
  onPick,
  rationale,
}: {
  row: PresetRow;
  picked: boolean;
  onPick: () => void;
  rationale: {
    meta: NonNullable<FixRackDto['coachMeta']>;
    open: boolean;
    toggle: () => void;
  } | null;
}) {
  const disabled = row.presetId == null;
  return (
    <div className="ip-preset">
      <button
        type="button"
        className={`ip-pick${picked ? ' on' : ''}`}
        disabled={disabled}
        title={disabled ? 'This preset has no carry-over handle — open it from Send to Listen.' : ''}
        onClick={onPick}
      >
        <span className="ck radio">{picked && <span className="dot" />}</span>
        <span className="t">
          {row.name}
          {row.auto && <span className="pr2-badge">auto</span>}
        </span>
        <span className="mono fx-scope">{row.moduleCount} devices</span>
      </button>
      {rationale && (
        <div className="ip-rationale">
          <button type="button" className="addr-lnk" onClick={rationale.toggle}>
            {rationale.open ? '▾' : '▸'} Why the Coach chose these
          </button>
          {rationale.open && (
            <div className="ip-rationale-body">
              {(rationale.meta.change_log ?? []).map((c, i) => (
                <div className="rl" key={i}>
                  <span className="mono mod">{c.module}</span>
                  <span className="chg">{c.change}</span>
                  {c.why && <span className="why">— {c.why}</span>}
                </div>
              ))}
              {rationale.meta.arbiter_notes && (
                <p className="fbd-dataexp" style={{ marginTop: 6 }}>
                  {rationale.meta.arbiter_notes}
                </p>
              )}
              {(rationale.meta.change_log ?? []).length === 0 && !rationale.meta.arbiter_notes && (
                <p className="fbd-dataexp">No rationale was recorded for this preset.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
