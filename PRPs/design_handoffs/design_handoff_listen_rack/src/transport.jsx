/* SPECTR · Listen rack redesign — transport (scrubber + controls) */
const { useMemo: useMemoT, useRef: useRefT, useState: useStateT } = React;

const SECTION_COLORS = {
  intro: 'rgba(255,255,255,0.10)',
  buildup: 'rgba(0,229,176,0.32)',
  drop: 'rgba(251,146,60,0.55)',
  breakdown: 'rgba(167,139,250,0.45)',
  outro: 'rgba(255,255,255,0.10)',
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Transport({ track, playing, position, onTogglePlay, onSeek, notes, onNoteClick, activeNote, reactions = [] }) {
  const dur = track.durationSec;
  const pct = position / dur;
  const total = track.arrangement.sections.reduce((s, x) => s + x.bars, 0);

  const waveform = useMemoT(() => {
    const arr = []; let acc = 0;
    for (const sec of track.arrangement.sections) {
      const base = sec.t === 'drop' ? 0.86 : sec.t === 'buildup' ? 0.55 : sec.t === 'breakdown' ? 0.35 : sec.t === 'intro' ? 0.28 : 0.34;
      const bars = sec.bars * 3;
      for (let i = 0; i < bars; i++) {
        const local = i / bars; let amp = base;
        if (sec.t === 'buildup') amp = base + local * 0.35;
        if (sec.t === 'outro') amp = base * (1 - local * 0.7);
        const noise = (Math.sin(acc * 0.7) * 0.5 + 0.5) * 0.2 + (Math.sin(acc * 2.3) * 0.5 + 0.5) * 0.15;
        arr.push(Math.max(0.05, Math.min(1, amp + noise * 0.4 - 0.1))); acc++;
      }
    }
    return arr;
  }, [track]);

  const ribbon = []; let p = 0;
  for (const sec of track.arrangement.sections) { const w = sec.bars / total; ribbon.push({ ...sec, x: p, w }); p += w; }
  const ref = useRefT(null);
  const [hover, setHover] = useStateT(null);
  const seekAt = (e) => { const r = ref.current.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur); };

  return (
    <div style={{ padding: '14px 20px 16px' }}>
      {/* waveform */}
      <div ref={ref} onClick={seekAt} onMouseMove={(e) => { const r = ref.current.getBoundingClientRect(); setHover({ t: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur, x: e.clientX - r.left }); }} onMouseLeave={() => setHover(null)}
        style={{ position: 'relative', height: 54, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none' }}>
        {waveform.map((v, i) => { const played = i / waveform.length <= pct; return (
          <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: played ? 'var(--cyan)' : 'rgba(255,255,255,0.13)', borderRadius: 1 }} />
        ); })}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct * 100}%`, width: 2, background: 'white', opacity: 0.85, boxShadow: '0 0 8px rgba(0,229,176,0.8)', pointerEvents: 'none' }} />
        {hover && <div className="mono" style={{ position: 'absolute', bottom: '100%', marginBottom: 6, left: hover.x, transform: 'translateX(-50%)', background: 'var(--card)', border: '1px solid var(--border)', padding: '3px 7px', borderRadius: 4, fontSize: 10, color: 'var(--text-2)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{fmtTime(hover.t)}</div>}
      </div>
      {/* reactions that happened on the timeline */}
      {reactions.filter((r) => r.emoji).length > 0 && (
        <div style={{ position: 'relative', height: 15, marginTop: 2 }}>
          {reactions.filter((r) => r.emoji).slice(0, 30).map((r) => (
            <span key={r.id} title={`@${r.handle} · ${fmtTime(r.t)}`} style={{ position: 'absolute', left: `${Math.max(0, Math.min(100, (r.t / dur) * 100))}%`, transform: 'translateX(-50%)', fontSize: 11, opacity: 0.92 }}>{r.emoji}</span>
          ))}
        </div>
      )}
      {/* note markers */}
      <div style={{ position: 'relative', height: 20, marginTop: 3 }}>
        {notes.map((n) => { const cp = n.t / dur, active = activeNote === n.id, c = n.pinned ? 'var(--cyan)' : 'var(--violet)'; return (
          <button key={n.id} onClick={() => onNoteClick(n)} title={n.text}
            style={{ position: 'absolute', left: `${cp * 100}%`, top: 0, transform: 'translateX(-50%)', width: 15, height: 15, borderRadius: 4, background: c, color: '#06151a', display: 'grid', placeItems: 'center', fontSize: 8, fontWeight: 800, border: active ? '2px solid white' : '2px solid var(--bg)', boxShadow: active ? `0 0 12px ${c}` : `0 0 6px ${c}66` }}>{n.pinned ? '★' : '·'}</button>
        ); })}
      </div>
      {/* controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <button onClick={onTogglePlay} style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--cyan)', color: '#06151a', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 14, boxShadow: playing ? '0 0 22px rgba(0,229,176,0.55), 0 0 0 1px rgba(0,229,176,0.6)' : '0 0 12px rgba(0,229,176,0.3)' }}>{playing ? '⏸' : '▶'}</button>
        <button className="btn ghost sm" style={{ width: 34, height: 34, padding: 0, justifyContent: 'center' }} onClick={() => onSeek(Math.max(0, position - 10))}>⏮</button>
        <button className="btn ghost sm" style={{ width: 34, height: 34, padding: 0, justifyContent: 'center' }} onClick={() => onSeek(Math.min(dur, position + 10))}>⏭</button>
        <div className="mono" style={{ fontSize: 12, minWidth: 104 }}><span style={{ color: 'var(--cyan)' }}>{fmtTime(position)}</span><span style={{ color: 'var(--muted)' }}> / {fmtTime(dur)}</span></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>VOL</span>
            <div style={{ position: 'relative', width: 80, height: 4, background: 'var(--dim)', borderRadius: 2 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '78%', background: 'var(--cyan)', borderRadius: 2 }} />
              <div style={{ position: 'absolute', top: '50%', left: '78%', width: 11, height: 11, borderRadius: '50%', background: 'var(--cyan)', transform: 'translate(-50%,-50%)' }} />
            </div>
          </div>
          <button className="btn sm">+ Note @ {fmtTime(position)}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Transport, SECTION_COLORS, fmtTime });
