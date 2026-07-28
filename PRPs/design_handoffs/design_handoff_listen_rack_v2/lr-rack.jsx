/* spectre — Listen Rack redesign. Dense toolbar + compact module grid/list + editor drawer. */
const { useState: rS, useMemo: rM } = React;

// shared drag-to-reorder plumbing (cards/rows ARE the chain)
function useChainDrag(rack) {
  const [drag, setDrag] = rS(null), [over, setOver] = rS(null);
  const dragProps = (id) => ({
    draggable: true,
    onDragStart: (e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; },
    onDragEnter: () => setOver(id),
    onDragOver: (e) => e.preventDefault(),
    onDragEnd: () => { setDrag(null); setOver(null); },
    onDrop: (e) => { e.stopPropagation(); if (drag) rack.reorder(drag, id); setDrag(null); setOver(null); },
  });
  const endProps = {
    onDragOver: (e) => e.preventDefault(),
    onDrop: () => { if (drag) rack.reorder(drag, null); setDrag(null); setOver(null); },
  };
  return { drag, over, dragProps, endProps };
}

function Toolbar({ rack, tw }) {
  const on = rack.order.filter((id) => rack.mod[id].enabled).length;
  return (
    <div className={'lr-bar' + (tw.stickyToolbar ? ' stick' : '')}>
      <span className="lr-cnt"><b>{on}</b>/{rack.order.length} modules on</span>
      <span className="lr-div" />
      <select className="lr-sel" value="" onChange={() => {}} title="Chain presets">
        <option value="">Presets ({rack.presets.length})</option>
        {rack.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn sm ghost" onClick={rack.savePreset} title="Save this chain as a preset"><Icon name="save" size={13} />Save</button>
      <div className="rgt">
        <label className={'lr-byp' + (rack.bypass ? ' on' : '')} title="Bypass the whole insert chain">
          BYPASS<Sw on={rack.bypass} onChange={rack.setBypass} />
        </label>
      </div>
    </div>);
}

// ── Card / row ─────────────────────────────────────────────────────────
function ModCard({ m, i, v, on, sel, gr, onSelect, onToggle, tw, dragging, isOver, dragProps }) {
  const sum = paramSummary(m, v);
  return (
    <div className={'lr-mc' + (on ? ' on' : '') + (sel ? ' sel' : '') + (dragging ? ' dragging' : '') + (isOver ? ' over' : '')}
      style={{ '--mac': m.accent }} onClick={onSelect} title={m.label + ' — drag to reorder the chain'} {...dragProps}>
      <div className="lr-mc-h">
        <span className="ix">{String(i + 1).padStart(2, '0')}</span>
        <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
        <span className="lr-mc-t">
          <span className="lr-mc-n">{m.label}</span>
          <span className="lr-mc-s">{m.sub}{m.worklet && tw.workletFlag ? ' · worklet' : ''}</span>
        </span>
        <Sw on={on} onChange={onToggle} title={m.label + ' on/off'} />
      </div>
      <div className="lr-mc-p">{sum ? <b>{sum}</b> : <span className="zz">neutral</span>}</div>
      {m.hasMeter && <div className="lr-gr"><i style={{ width: (on ? lrClamp(gr / 6, 0, 1) * 100 : 0) + '%' }} /></div>}
    </div>);
}
function ModRow({ i, m, v, on, sel, gr, onSelect, onToggle, tw, dragging, isOver, dragProps }) {
  const sum = paramSummary(m, v);
  return (
    <div className={'lr-row' + (on ? ' on' : '') + (sel ? ' sel' : '') + (dragging ? ' dragging' : '') + (isOver ? ' over' : '')}
      style={{ '--mac': m.accent }} onClick={onSelect} title={m.label + ' — drag to reorder the chain'} {...dragProps}>
      <span className="ix">{String(i + 1).padStart(2, '0')}</span>
      <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
      <span className="lr-mc-n">{m.label}</span>
      <span className="lr-mc-s">{m.sub}</span>
      <span className="lr-mc-p">{sum ? <b>{sum}</b> : <span className="zz">neutral</span>}</span>
      {m.hasMeter ? <div className="lr-gr"><i style={{ width: (on ? lrClamp(gr / 6, 0, 1) * 100 : 0) + '%' }} /></div> : <span className="lr-gr" style={{ background: 'transparent' }} />}
      {tw.showBind && <span className="lr-mc-s" style={{ width: 210, color: 'var(--violet)' }}>{m.bind}</span>}
      <Sw on={on} onChange={onToggle} title={m.label + ' on/off'} />
    </div>);
}

// ── Editor drawer ──────────────────────────────────────────────────────
function Editor({ m, rack, onClose, tw }) {
  const v = rack.mod[m.id];
  const inChain = rack.order.includes(m.id);
  return (
    <div className="lr-ed" style={{ '--mac': m.accent }}>
      <div className="lr-ed-h">
        <span className={'lr-glyph' + (v.enabled ? '' : ' off')}>{m.glyph}</span>
        <span><span className="n">{m.label}</span> <span className="s">{m.sub}</span></span>
        {tw.showBind && <span className="lr-bind">{m.bind}</span>}
        <span style={{ flex: 1 }} />
        {inChain && <React.Fragment>
          <button className="lr-ib" title="Move earlier in chain" onClick={() => rack.move(m.id, -1)}><span style={{ display: 'grid', transform: 'rotate(180deg)' }}><Icon name="chevron" size={13} /></span></button>
          <button className="lr-ib" title="Move later in chain" onClick={() => rack.move(m.id, 1)}><Icon name="chevron" size={13} /></button>
        </React.Fragment>}
        <button className="lr-ib" title="Reset to neutral" onClick={() => rack.reset(m.id)}><Icon name="refresh" size={13} /></button>
        <Sw on={v.enabled} onChange={() => rack.toggle(m.id)} />
        <button className="lr-ib" title="Close" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="lr-ed-b">
        {m.perBand
          ? <EqStrip bands={v.bands} setBand={rack.setBand} />
          : m.params.filter((p) => p.key !== 'enabled').map((p) =>
            <ParamControl key={p.key} p={p} value={v[p.key]} onChange={(nv) => rack.patch(m.id, { [p.key]: nv })} />)}
      </div>
    </div>);
}

// ── Detached pitch device (buffer lane) shown after the chain ──────────
function PitchCard({ rack, sel, setSel, row }) {
  const m = PITCH_MODULE, v = rack.mod.pitch, on = v.enabled && !rack.bypass;
  const cls = (row ? 'lr-row' : 'lr-mc') + ' lane' + (on ? ' on' : '') + (sel === 'pitch' ? ' sel' : '');
  const sum = paramSummary(m, v);
  const inner = row
    ? <React.Fragment>
        <span className="ix">LN</span>
        <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
        <span className="lr-mc-n">{m.label}</span>
        <span className="lr-mc-s">{m.sub}</span>
        <span className="lr-mc-p">{sum ? <b>{sum}</b> : <span className="zz">buffer lane · not an insert</span>}</span>
        <span className="lr-gr" style={{ background: 'transparent' }} />
        <Sw on={v.enabled} onChange={() => rack.toggle('pitch')} title="Pitch on/off" />
      </React.Fragment>
    : <React.Fragment>
        <div className="lr-mc-h">
          <span className="ix">LN</span>
          <span className={'lr-glyph' + (on ? '' : ' off')}>{m.glyph}</span>
          <span className="lr-mc-t">
            <span className="lr-mc-n">{m.label}</span>
            <span className="lr-mc-s">{m.sub}</span>
          </span>
          <Sw on={v.enabled} onChange={() => rack.toggle('pitch')} title="Pitch on/off" />
        </div>
        <div className="lr-mc-p">{sum ? <b>{sum}</b> : <span className="zz">buffer lane · not an insert</span>}</div>
      </React.Fragment>;
  return <div className={cls} style={{ '--mac': 'var(--violet)' }} onClick={() => setSel(sel === 'pitch' ? null : 'pitch')}
    title="Pitch & tempo — separate buffer lane, not an insert">{inner}</div>;
}

// ── Rack tab ───────────────────────────────────────────────────────────
function RackTab({ rack, meters, tw, sel, setSel }) {
  // chain order is the single authoritative source for module order
  const list = rM(() => rack.order.map((id) => MANIFEST_BY_ID[id]), [rack.order]);
  const selM = sel ? MANIFEST_BY_ID[sel] : null;
  const pick = (id) => setSel(sel === id ? null : id);
  const dnd = useChainDrag(rack);
  const item = (m, i, Row) =>
    <Row key={m.id} m={m} i={i} v={rack.mod[m.id]} on={rack.mod[m.id].enabled && !rack.bypass} sel={sel === m.id}
      gr={meters.gr} tw={tw} onSelect={() => pick(m.id)} onToggle={() => rack.toggle(m.id)}
      dragging={dnd.drag === m.id} isOver={dnd.over === m.id} dragProps={dnd.dragProps(m.id)} />;
  return (
    <React.Fragment>
      <Toolbar {...{ rack, tw }} />
      <div className="lr-grid" {...dnd.endProps}>
        {list.map((m, i) => item(m, i, ModCard))}
        <PitchCard rack={rack} sel={sel} setSel={setSel} />
      </div>
      {selM && <DeviceBay m={selM} i={rack.order.indexOf(selM.id)} rack={rack} gr={meters.gr} tw={tw} onClose={() => setSel(null)} />}
    </React.Fragment>);
}
Object.assign(window, { Toolbar, ModCard, ModRow, PitchCard, useChainDrag, Editor, RackTab });
