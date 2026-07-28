/* spectre — Listen Rack redesign. Compact sidebar + secondary tab bodies. */
const { useState: pS } = React;

// ── Sidebar: chain order · coach fixes · meters ─────────────────────────
function ChainCard({ rack, sel, setSel }) {
  return (
    <div className="lr-sc">
      <div className="lr-sc-h"><span className="l">Insert chain</span><span className="hint">{rack.order.filter((id) => rack.mod[id].enabled).length}/{rack.order.length}</span></div>
      <div className="lr-sc-b">{rack.order.map((id) => {
        const m = MANIFEST_BY_ID[id], on = rack.mod[id].enabled && !rack.bypass;
        return (
          <div key={id} className={'lr-cr' + (on ? ' on' : '')} style={{ '--mac': m.accent }} onClick={() => setSel(sel === id ? null : id)}>
            <span className="d" /><span className="nm">{m.label}</span>
            <span className="mv">
              <button title="Earlier" onClick={(e) => { e.stopPropagation(); rack.move(id, -1); }}>↑</button>
              <button title="Later" onClick={(e) => { e.stopPropagation(); rack.move(id, 1); }}>↓</button>
            </span>
          </div>);
      })}</div>
    </div>);
}

function MeterRow({ label, value, fmt, min, max, hot }) {
  return (
    <div className="lr-mtr">
      <div className="r"><span>{label}</span><b>{fmt}</b></div>
      <div className="bar"><i className={hot ? 'hot' : ''} style={{ width: lrClamp((value - min) / (max - min), 0, 1) * 100 + '%' }} /></div>
    </div>);
}
function MetersCard({ meters }) {
  return (
    <div className="lr-sc">
      <div className="lr-sc-h"><span className="l">Output</span><span className="hint">live</span></div>
      <div className="lr-sc-b" style={{ gap: 9 }}>
        <MeterRow label="LUFS-S" value={meters.lufs} fmt={meters.lufs.toFixed(1)} min={-20} max={-6} hot={meters.lufs > -10.5} />
        <MeterRow label="TRUE PEAK" value={meters.tp} fmt={meters.tp.toFixed(1) + ' dBTP'} min={-6} max={0} hot={meters.tp > -0.3} />
        <MeterRow label="CORRELATION" value={meters.corr} fmt={meters.corr.toFixed(2)} min={-1} max={1} />
        <MeterRow label="GAIN REDUCTION" value={meters.gr} fmt={'−' + meters.gr.toFixed(1) + ' dB'} min={0} max={6} hot={meters.gr > 2.5} />
      </div>
    </div>);
}

function FixesCard({ rack, onApply }) {
  const [done, setDone] = pS({});
  return (
    <div className="lr-sc">
      <div className="lr-sc-h"><span className="l">Fixes from analysis</span><span className="hint">{PLAN_ITEMS.length - Object.keys(done).length} left</span></div>
      <div className="lr-sc-b">{PLAN_ITEMS.map((p) =>
        <button key={p.id} className={'lr-fix' + (done[p.id] ? ' done' : '')} onClick={() => { rack.applyFix(p.apply); setDone((d) => ({ ...d, [p.id]: true })); onApply(p); }}>
          <span className="tg" style={{ color: p.color, background: `color-mix(in srgb, ${p.color} 12%, transparent)` }}>{p.tag}</span>
          <span className="bb"><span className="t">{p.title}</span><span className="s">{p.fix}</span></span>
          {done[p.id] ? <span className="ck"><Icon name="check" size={13} /></span> : <span className="ck" style={{ color: 'var(--muted)' }}><Icon name="plus" size={13} /></span>}
        </button>)}
      </div>
    </div>);
}

// ── Session card: Notes · Chat · Room in the sidebar ───────────────────
const LR_CHAT_SEED = [
  { id: 's1', handle: 'vela', text: 'the breakdown reverb is doing a lot', t: 132 },
  { id: 's2', handle: 'forge', text: 'kick could hit harder imo', t: 70 },
];
function SessionCard({ activeNote, onNote, myStatus, setMyStatus }) {
  const [t, setT] = pS('notes');
  const [msgs, setMsgs] = pS(LR_CHAT_SEED);
  const [text, setText] = pS('');
  const send = () => { if (!text.trim()) return; setMsgs((m) => [...m, { id: 'm' + m.length, handle: 'maek', you: true, text: text.trim() }]); setText(''); };
  return (
    <div className="lr-sc">
      <div className="lr-mtabs">
        {[['notes', 'Notes', TRACK.notes.length], ['chat', 'Chat', msgs.length], ['room', 'Room', ROOM_LISTENERS.length]].map(([id, l, n]) =>
          <button key={id} className={t === id ? 'on' : ''} onClick={() => setT(id)}>{l}<span className="n">{n}</span></button>)}
      </div>
      {t === 'notes' &&
        <div className="lr-sc-b">{TRACK.notes.map((n) =>
          <button key={n.id} className={'lr-snote' + (activeNote === n.id ? ' on' : '')} onClick={() => onNote(n)}>
            <span className="tm">{lrTime(n.t)}</span><span className="tx">{n.text}</span>
            {n.pinned && <span className="pin" title="pinned">●</span>}
          </button>)}
        </div>}
      {t === 'chat' &&
        <div className="lr-sc-b">
          {msgs.map((m) =>
            <div key={m.id} className="lr-msg">
              <span className="lr-pav" style={{ background: `oklch(0.74 0.15 ${m.you ? 168 : 20})` }}>{m.handle[0].toUpperCase()}</span>
              <span className="bb"><span className="h">@{m.handle}</span><span className="x">{m.text}</span></span>
            </div>)}
          <div className="lr-cin">
            <input value={text} placeholder="Say something…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button onClick={send} title="Send"><Icon name="send" size={13} /></button>
          </div>
        </div>}
      {t === 'room' &&
        <div className="lr-sc-b">
          <div className="lr-people">{ROOM_LISTENERS.map((l) =>
            <span key={l.handle} className="lr-pchip">
              <span className="lr-pav" style={{ background: `oklch(0.74 0.15 ${l.hue})` }}>{l.anon ? '?' : l.handle[0].toUpperCase()}</span>
              {l.anon ? 'anon' : '@' + l.handle}<span className="st">{l.you ? myStatus : l.state}</span>
            </span>)}
          </div>
          <div className="lr-react">{REACTION_GROUPS.map((g) =>
            <div key={g.id} className="rg">
              <span className="gl" style={{ color: g.tone }}>{g.sign}</span>
              {g.emojis.map((e) => <button key={e} className={myStatus === e ? 'on' : ''} onClick={() => setMyStatus(e)}>{e}</button>)}
            </div>)}
          </div>
        </div>}
    </div>);
}

function Sidebar({ rack, meters, sel, setSel, onApply, tw, activeNote, onNote, myStatus, setMyStatus }) {
  return (
    <aside className="lr-side">
      <SessionCard activeNote={activeNote} onNote={onNote} myStatus={myStatus} setMyStatus={setMyStatus} />
    </aside>);
}

// ── Coach tab: coach moves + fixes from analysis, side by side ──────────
function CoachTab({ rack, onApply }) {
  const [done, setDone] = pS({});
  const [fixDone, setFixDone] = pS({});
  return (
    <div>
      <p className="tab-intro">The coach reads this track's analysis live. Each move applies straight into the rack — <b>you hear it before you commit</b>.</p>
      <div className="lr-coach2">
        <div>
          <SecLabel hint={COACH_SUGGESTIONS.length - Object.keys(done).length + ' left'}>Coach moves</SecLabel>
          <div className="lr-nl">{COACH_SUGGESTIONS.map((c) =>
            <div key={c.id} className="lr-nr" style={{ alignItems: 'center' }}>
              <span className="tm" style={{ color: c.color, width: 68, fontSize: 8.5, fontWeight: 700, letterSpacing: '.07em' }}>{c.persona}</span>
              <span className="tx" style={{ color: 'var(--text)' }}>{c.title}</span>
              <span className="tm lr-move" style={{ width: 'auto', color: 'var(--muted)' }}>{c.move}</span>
              <button className={done[c.id] ? 'btn sm' : 'btn sm primary'} onClick={() => { rack.applyFix(c.apply); setDone((d) => ({ ...d, [c.id]: true })); onApply(c); }}>
                {done[c.id] ? <React.Fragment><Icon name="check" size={13} />Applied</React.Fragment> : 'Apply'}
              </button>
            </div>)}
          </div>
        </div>
        <div>
          <SecLabel hint={PLAN_ITEMS.length - Object.keys(fixDone).length + ' left'}>Fixes from analysis</SecLabel>
          <div className="lr-nl">{PLAN_ITEMS.map((f) =>
            <button key={f.id} className={'lr-fix' + (fixDone[f.id] ? ' done' : '')} onClick={() => { rack.applyFix(f.apply); setFixDone((d) => ({ ...d, [f.id]: true })); onApply(f); }}>
              <span className="tg" style={{ color: f.color, background: `color-mix(in srgb, ${f.color} 12%, transparent)` }}>{f.tag}</span>
              <span className="bb"><span className="t">{f.title}</span><span className="s">{f.fix}</span></span>
              {fixDone[f.id] ? <span className="ck"><Icon name="check" size={13} /></span> : <span className="ck" style={{ color: 'var(--muted)' }}><Icon name="plus" size={13} /></span>}
            </button>)}
          </div>
        </div>
      </div>
    </div>);
}

Object.assign(window, { Sidebar, SessionCard, ChainCard, MetersCard, FixesCard, CoachTab });
