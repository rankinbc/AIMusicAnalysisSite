/* SPECTR · Listen rack redesign — InlineRack (the chosen IA direction)
 * A rich horizontal chain with inline rich controls + drag-reorder. The other
 * IA directions (Pedalboard / Console / Studio) from the prototype are NOT
 * ported per PORTING_GUIDE §1e (port InlineRack only).
 */
import { Fragment, useRef, useState } from 'react';

import {
  CREATIVE_IDS, MANIFEST_BY_ID, MASTERING_IDS, PITCH_MODULE,
} from './data';
import { cssVar } from './helpers';
import { RackChrome, RichControls } from './rackCore';
import { useChainReorder, type RackState } from './rackState';
import { BindTag, ModuleIcon, ParamControl, Switch, WorkletPill } from './ui';

type Reorder = ReturnType<typeof useChainReorder>;

function Connector() {
  return <div style={{ flexShrink: 0, alignSelf: 'center', color: 'var(--muted)', fontSize: 14, padding: '0 2px' }}>→</div>;
}

function ChainCap({ label, right }: { label: string; right?: boolean }) {
  return (
    <div style={{ flexShrink: 0, alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: right ? '0 0 0 4px' : '0 4px 0 0' }}>
      {right
        ? <><span style={{ color: 'var(--cyan)', fontSize: 14 }}>→</span><span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{label}</span></>
        : <><span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{label}</span><span style={{ color: 'var(--cyan)', fontSize: 14 }}>→</span></>}
    </div>
  );
}

function PitchLane({ rs }: { rs: RackState }) {
  const m = PITCH_MODULE, st = rs.mod.pitch, on = st.enabled;
  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', borderRadius: 9, background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.22)' }}>
      <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={24} />
      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Pitch <span className="mono" style={{ fontSize: 8.5, color: 'var(--violet)', marginLeft: 4 }}>SEPARATE LANE</span></div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--muted)' }}>not an insert · pitch + tempo coupled</div>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginLeft: 'auto' }}>
        {m.params.map((p) => <ParamControl key={p.key} p={p} value={st[p.key]} accent={m.accent} dim={!on} knobSize={38} onChange={(k, v) => rs.setParam('pitch', k, v)} />)}
        <Switch on={on} onChange={(v) => rs.setEnabled('pitch', v)} accent={m.accent} />
      </div>
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>
  );
}

// abbreviated chain map — all modules as icons in signal order, drag to reorder
function ChainMap({ rs, onFocus, showInactive, setShowInactive }: {
  rs: RackState; onFocus?: (id: string) => void; showInactive: boolean; setShowInactive: (v: boolean) => void;
}) {
  const reorder = useChainReorder(rs.order, rs.setOrder);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', fontWeight: 700, marginRight: 2 }}>CHAIN</span>
      <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>in</span>
      <div ref={reorder.containerRef} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {rs.order.map((id, i) => {
          const m = MANIFEST_BY_ID[id], on = rs.mod[id].enabled && !rs.masterBypass;
          const dragging = reorder.draggingId === id;
          return (
            <Fragment key={id}>
              {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>›</span>}
              <button type="button" data-chip onPointerDown={reorder.onHandleDown(id)} onClick={() => onFocus && onFocus(id)} onDoubleClick={() => rs.setEnabled(id, !rs.mod[id].enabled)} title={`${m.label} — click to focus · double-click to ${on ? 'disable' : 'enable'} · drag to reorder`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, cursor: 'grab', touchAction: 'none', transition: 'transform .1s, box-shadow .1s',
                  background: dragging ? 'rgba(0,229,176,0.18)' : on ? `${cssVar(m.accent)}14` : 'rgba(255,255,255,0.02)', border: `1px solid ${dragging ? 'var(--cyan)' : on ? `${cssVar(m.accent)}44` : 'var(--border)'}`, boxShadow: dragging ? '0 0 0 2px rgba(0,229,176,0.4)' : 'none', transform: dragging ? 'scale(1.08)' : 'none' }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: on ? m.accent : 'var(--muted)' }}>{m.glyph}</span>
                <span className="mono" style={{ fontSize: 9, color: on ? 'var(--text-2)' : 'var(--muted)' }}>{m.label.split(' ')[0]}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
      <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>→ Σ out</span>
      <label title="Show disabled devices as full panels below (they always stay in this mini map)" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.04em', color: showInactive ? 'var(--text-2)' : 'var(--muted)' }}>Show inactive</span>
        <Switch on={showInactive} onChange={setShowInactive} size="sm" />
      </label>
    </div>
  );
}

// rich module panel — full param set inline, no drill-down
function RichModulePanel({ id, rs, playing, reorder, draggable, pos, registerRef }: {
  id: string; rs: RackState; playing: boolean; reorder: Reorder; draggable?: boolean; pos?: number;
  registerRef?: (el: HTMLDivElement | null) => void;
}) {
  const m = MANIFEST_BY_ID[id], st = rs.mod[id], on = st.enabled && !rs.masterBypass;
  const wide = id === 'eq';
  const dragging = reorder.draggingId === id;
  return (
    <div data-chip ref={registerRef} onDoubleClick={() => rs.setEnabled(id, !st.enabled)}
      style={{ flexShrink: 0, width: wide ? 300 : 212, borderRadius: 11, padding: 12, position: 'relative', transition: 'box-shadow .12s, transform .12s',
        background: on ? `${cssVar(m.accent)}0b` : 'var(--card)',
        border: `1px solid ${dragging ? 'var(--cyan)' : on ? `${cssVar(m.accent)}38` : 'var(--border)'}`,
        outline: dragging ? '2px dashed var(--cyan)' : 'none', outlineOffset: 2,
        boxShadow: dragging ? '0 14px 36px -10px rgba(0,229,176,0.55)' : 'none',
        transform: dragging ? 'scale(1.02)' : 'none', zIndex: dragging ? 5 : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {draggable && <span onPointerDown={reorder.onHandleDown(id)} title="Drag to reorder" style={{ cursor: 'grab', color: dragging ? 'var(--cyan)' : 'var(--muted)', fontSize: 13, touchAction: 'none' }}>⠿</span>}
        <ModuleIcon glyph={m.glyph} accent={m.accent} on={on} size={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: on ? 'var(--text)' : 'var(--text-2)' }}>{m.label}</div>
          <div className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{pos != null ? `#${pos} · ` : ''}{m.sub}</div>
        </div>
        {m.worklet && <WorkletPill ready={playing} />}
        <Switch on={st.enabled} onChange={(v) => rs.setEnabled(id, v)} accent={m.accent} size="sm" />
      </div>
      <RichControls id={id} rs={rs} playing={playing} />
      <BindTag bind={m.bind} show={rs.showBind} />
    </div>
  );
}

export function InlineRack({ rs, playing }: { rs: RackState; playing: boolean; controller?: string | null }) {
  const reorder = useChainReorder(rs.order, rs.setOrder);
  const panelEls = useRef<Record<string, HTMLDivElement | null>>({});
  const [showInactive, setShowInactive] = useState(true);
  const focusModule = (id: string) => {
    const cont = reorder.containerRef.current, el = panelEls.current[id];
    if (cont && el) cont.scrollTo({ left: Math.max(0, el.offsetLeft - 24), behavior: 'smooth' });
  };
  const chain = rs.order.filter((id) => showInactive ? (MASTERING_IDS.includes(id) || rs.mod[id].enabled) : rs.mod[id].enabled);
  const disabledCreative = CREATIVE_IDS.filter((id) => !rs.mod[id].enabled);
  return (
    <div className="card lr-rack-panel" style={{ overflow: 'visible' }}>
      <div className="card-hd"><RackChrome rs={rs} dense /></div>
      <div className="card-body">
        <ChainMap rs={rs} onFocus={focusModule} showInactive={showInactive} setShowInactive={setShowInactive} />
        <div ref={reorder.containerRef} style={{ display: 'flex', alignItems: 'stretch', gap: 6, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 8 }}>
          <ChainCap label="IN" />
          {chain.map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <Connector />}
              <RichModulePanel id={id} rs={rs} playing={playing} reorder={reorder} draggable pos={i + 1} registerRef={(el) => { panelEls.current[id] = el; }} />
            </Fragment>
          ))}
          <ChainCap label="OUT" right />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--violet)', fontWeight: 700 }}>+ CREATIVE FX</span>
          {disabledCreative.length === 0
            ? <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>all inserted</span>
            : disabledCreative.map((id) => {
              const m = MANIFEST_BY_ID[id];
              return (
                <button type="button" key={id} onClick={() => rs.setEnabled(id, true)} title={m.summary} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent' }}>
                  <span style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{m.glyph}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>{m.label}</span>
                  <span style={{ color: m.accent, fontSize: 12, fontWeight: 700 }}>+</span>
                </button>
              );
            })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Pitch lane</span>
            <Switch on={rs.mod.pitch.enabled} onChange={(v) => rs.setEnabled('pitch', v)} accent="var(--violet)" />
          </div>
        </div>
        {rs.mod.pitch.enabled && <div style={{ marginTop: 12 }}><PitchLane rs={rs} /></div>}
      </div>
    </div>
  );
}
