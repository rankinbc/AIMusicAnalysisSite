/* Listen Rack v2 — Rack tab: dense toolbar + module card grid (the grid IS the
 * insert chain — drag to reorder) + detached pitch lane card + device bay.
 * Ported from the design handoff (lr-rack.jsx), wired to RackState. */
import { useMemo, useState } from 'react';

import { Icon } from '../results/Icon';
import { DeviceBayV2 } from './DeviceBayV2';
import { MANIFEST_BY_ID, PITCH_MODULE, type ModuleManifest } from './data';
import { Sw } from './lrControls';
import { lrClamp, paramSummary } from './lrUtil';
import { useGainReduction, type RackPreset, type RackState } from './rackState';
import type { LiveMeters } from './useLiveMeters';

// ── Toolbar LCD — live output meters as a digital display module ───────
function MeterLcd({ meters }: { meters: LiveMeters }) {
  const seg = (label: string, val: string, warn: boolean) => (
    <span className="seg" key={label} {...(warn ? { 'data-warn': '' } : {})}>
      <span className="l">{label}</span>
      <span className="v">{val}</span>
    </span>
  );
  return (
    <div className="lr-lcd" title="Live output meters — output level, short-term loudness, true peak, L/R correlation, gain reduction. CLIP latches red for 2s when the true peak hits 0 dBTP.">
      <div className="win">
        {seg('OUT', meters.out <= -60 ? '−∞' : meters.out.toFixed(1), meters.out > -6)}
        {seg('LUFS-S', meters.lufs.toFixed(1), meters.lufs > -10.5)}
        {seg('TP', meters.tp.toFixed(1), meters.tp > -0.3)}
        {seg('CORR', meters.corr.toFixed(2), false)}
        {seg('GR', '−' + meters.gr.toFixed(1), meters.gr > 2.5)}
        <span className={'lcd-clip' + (meters.clip ? ' on' : '')} title="Clip indicator — output true peak hit 0 dBTP">
          <span className="led" />CLIP
        </span>
      </div>
    </div>
  );
}

// ── shared HTML5 drag-to-reorder plumbing (cards ARE the chain) ────────
function useChainDrag(order: string[], setOrder: (next: string[]) => void) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const reorder = (fromId: string, toId: string | null) => {
    if (fromId === toId) return;
    const n = order.filter((x) => x !== fromId);
    const at = toId == null ? n.length : n.indexOf(toId);
    n.splice(at < 0 ? n.length : at, 0, fromId);
    setOrder(n);
  };
  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; },
    onDragEnter: () => setOver(id),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragEnd: () => { setDrag(null); setOver(null); },
    onDrop: (e: React.DragEvent) => {
      e.stopPropagation();
      if (drag) reorder(drag, id);
      setDrag(null);
      setOver(null);
    },
  });
  const endProps = {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => { if (drag) reorder(drag, null); setDrag(null); setOver(null); },
  };
  return { drag, over, dragProps, endProps };
}

// ── Toolbar ────────────────────────────────────────────────────────────
function Toolbar({ rs, sticky, meters, presets, onRecallPreset, onSavePreset, onExport, onImport }: {
  rs: RackState; sticky: boolean;
  meters: LiveMeters;
  presets: RackPreset[];
  onRecallPreset: (id: string) => void;
  onSavePreset: () => void;
  onExport?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}) {
  const on = rs.order.filter((id) => rs.mod[id]?.enabled).length;
  return (
    <div className={'lr-bar' + (sticky ? ' stick' : '')}>
      <span className="lr-cnt"><b>{on}</b>/{rs.order.length} modules on</span>
      <span className="lr-div" />
      <select
        className="lr-sel"
        value=""
        onChange={(e) => { if (e.target.value) onRecallPreset(e.target.value); }}
        title="Chain presets"
      >
        <option value="">Presets ({presets.length})</option>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" className="btn sm ghost" onClick={onSavePreset} title="Save this chain as a preset">
        <Icon name="save" size={13} />Save
      </button>
      {onExport && (
        <button type="button" className="btn sm ghost" onClick={onExport} title="Export this chain as JSON">↧</button>
      )}
      {onImport && (
        <button type="button" className="btn sm ghost" onClick={onImport} title="Import a chain preset (JSON)">↥</button>
      )}
      <div className="rgt">
        <MeterLcd meters={meters} />
        <label className={'lr-byp' + (rs.masterBypass ? ' on' : '')} title="Bypass the whole insert chain">
          BYPASS<Sw on={rs.masterBypass} onChange={rs.setMasterBypass} />
        </label>
      </div>
    </div>
  );
}

// ── Module card ────────────────────────────────────────────────────────
interface ModCardProps {
  m: ModuleManifest; i: number; rs: RackState; playing: boolean;
  sel: boolean; showWorklet: boolean;
  onSelect: () => void;
  dragging: boolean; isOver: boolean;
  dragProps: Record<string, unknown>;
}

function ModCard({ m, i, rs, playing, sel, showWorklet, onSelect, dragging, isOver, dragProps }: ModCardProps) {
  const v = rs.mod[m.id];
  const on = Boolean(v?.enabled) && !rs.masterBypass;
  const grLive = useGainReduction(rs.graph, m.id, on && m.hasMeter, playing);
  if (!v) return null;
  const sum = paramSummary(m, v);
  const gr = Math.abs(grLive);
  return (
    <div
      className={'lr-mc' + (on ? ' on' : '') + (sel ? ' sel' : '') + (dragging ? ' dragging' : '') + (isOver ? ' over' : '')}
      style={{ ['--mac' as string]: m.accent }}
      onClick={onSelect}
      title={m.label + ' — drag to reorder the chain'}
      {...dragProps}
    >
      <div className="lr-mc-h">
        <span className="ix">{String(i + 1).padStart(2, '0')}</span>
        <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
        <span className="lr-mc-t">
          <span className="lr-mc-n">{m.label}</span>
          <span className="lr-mc-s">{m.sub}{m.worklet && showWorklet ? ' · worklet' : ''}</span>
        </span>
        <Sw on={v.enabled} onChange={(nv) => rs.setEnabled(m.id, nv)} title={m.label + ' on/off'} />
      </div>
      <div className="lr-mc-p">{sum ? <b>{sum}</b> : <span className="zz">neutral</span>}</div>
      {m.hasMeter && <div className="lr-gr"><i style={{ width: (on ? lrClamp(gr / 6, 0, 1) * 100 : 0) + '%' }} /></div>}
    </div>
  );
}

// ── Detached pitch device (buffer lane) shown after the chain ──────────
function PitchCard({ rs, sel, onSelect }: { rs: RackState; sel: boolean; onSelect: () => void }) {
  const m = PITCH_MODULE;
  const v = rs.mod['pitch'];
  if (!v) return null;
  const on = v.enabled && !rs.masterBypass;
  const sum = paramSummary(m, v);
  // Net playback speed = tempo × 2^(detune/1200); 1.00× means the Tempo knob
  // fully offsets the pitch shift's speed change.
  const netRate = (Number(v.tempo) || 1) * Math.pow(2, ((Number(v.semitones) || 0) * 100 + (Number(v.cents) || 0)) / 1200);
  return (
    <div
      className={'lr-mc lane' + (on ? ' on' : '') + (sel ? ' sel' : '')}
      style={{ ['--mac' as string]: 'var(--violet)' }}
      onClick={onSelect}
      title="Pitch & tempo — separate buffer lane, not an insert. Net speed = tempo × 2^(st/12); dial Tempo until it reads 1.00× to keep the original speed at the new pitch."
    >
      <div className="lr-mc-h">
        <span className="ix">LN</span>
        <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
        <span className="lr-mc-t">
          <span className="lr-mc-n">{m.label}</span>
          <span className="lr-mc-s">{m.sub}</span>
        </span>
        <Sw on={v.enabled} onChange={(nv) => rs.setEnabled('pitch', nv)} title="Pitch on/off" />
      </div>
      <div className="lr-mc-p">
        {sum ? <b>{sum} · net {netRate.toFixed(2)}×</b> : <span className="zz">buffer lane · not an insert</span>}
      </div>
    </div>
  );
}

// ── Rack tab ───────────────────────────────────────────────────────────
export function RackTabV2({ rs, playing, meters, readOnly, presets, onRecallPreset, onSavePreset, onExport, onImport }: {
  rs: RackState; playing: boolean;
  meters: LiveMeters;
  /** Capability-gated (guest / no rack-control grant): grid renders inert. */
  readOnly: boolean;
  presets: RackPreset[];
  onRecallPreset: (id: string) => void;
  onSavePreset: () => void;
  onExport?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
}) {
  // chain order is the single authoritative source for module order
  const list = useMemo(
    () => rs.order.map((id) => MANIFEST_BY_ID[id]).filter((m): m is ModuleManifest => m != null),
    [rs.order],
  );
  const sel = rs.selected;
  const selM = sel ? (sel === 'pitch' ? PITCH_MODULE : MANIFEST_BY_ID[sel]) : null;
  const pick = (id: string) => rs.setSelected(sel === id ? null : id);
  const dnd = useChainDrag(rs.order, rs.setOrder);

  const body = (
    <>
      <div className="lr-grid" {...dnd.endProps}>
        {list.map((m, i) => (
          <ModCard
            key={m.id}
            m={m}
            i={i}
            rs={rs}
            playing={playing}
            sel={sel === m.id}
            showWorklet
            onSelect={() => pick(m.id)}
            dragging={dnd.drag === m.id}
            isOver={dnd.over === m.id}
            dragProps={dnd.dragProps(m.id)}
          />
        ))}
        <PitchCard rs={rs} sel={sel === 'pitch'} onSelect={() => pick('pitch')} />
      </div>
      {selM && (
        <DeviceBayV2
          m={selM}
          i={rs.order.indexOf(selM.id)}
          rs={rs}
          playing={playing}
          showBind={rs.showBind}
          onClose={() => rs.setSelected(null)}
        />
      )}
    </>
  );

  return (
    <>
      <Toolbar
        rs={rs}
        sticky
        meters={meters}
        presets={presets}
        onRecallPreset={onRecallPreset}
        onSavePreset={onSavePreset}
        onExport={onExport}
        onImport={onImport}
      />
      {readOnly ? (
        <div style={{ position: 'relative' }}>
          <div style={{ pointerEvents: 'none', opacity: 0.9 }}>{body}</div>
          <div
            className="mono"
            style={{ position: 'absolute', top: 10, right: 12, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--violet)', padding: '4px 9px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)' }}
          >
            READ-ONLY
          </div>
        </div>
      ) : body}
    </>
  );
}
