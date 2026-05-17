/* SPECTR — Now Playing / Listen screen
 *
 * Personal listening view for the producer:
 *  - Big animated spectrum visualizer as the hero
 *  - Live meters that move with playback
 *  - Arrangement section overlay
 *  - Private session-notes timeline (timestamped notes the producer writes
 *    to themselves while listening back, NOT community comments)
 */

const { useState, useEffect, useRef, useMemo } = React;

function NowPlaying({ track, tweak }) {
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(42); // seconds
  const [hovering, setHovering] = useState(null);
  const [activeNote, setActiveNote] = useState(null);
  const positionRef = useRef(position);
  positionRef.current = position;

  // Tick playback
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const startPos = positionRef.current;
    let raf;
    function frame() {
      const elapsed = (performance.now() - start) / 1000;
      const p = startPos + elapsed;
      if (p >= track.durationSec) { setPosition(0); setPlaying(false); return; }
      setPosition(p);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, track.durationSec]);

  const currentSection = useMemo(() => {
    const total = track.arrangement.sections.reduce((s, x) => s + x.bars, 0);
    const acc = [];
    let pos = 0;
    for (const sec of track.arrangement.sections) {
      const w = sec.bars / total;
      acc.push({ ...sec, startPct: pos, endPct: pos + w });
      pos += w;
    }
    const pct = position / track.durationSec;
    return acc.find(s => pct >= s.startPct && pct < s.endPct) || acc[0];
  }, [position, track]);

  return (
    <div style={{
      maxWidth: 1360, margin: '0 auto',
      padding: '24px 24px 80px',
    }}>
      <TrackHeader track={track} />

      <HeroCard
        track={track}
        playing={playing}
        position={position}
        currentSection={currentSection}
        onTogglePlay={() => setPlaying(p => !p)}
        onSeek={(t) => setPosition(t)}
        onHoverTime={setHovering}
        hovering={hovering}
        activeNote={activeNote}
        onNoteClick={setActiveNote}
        tweak={tweak}
      />

      <ToolsRail track={track} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 360px',
        gap: 20,
        marginTop: 20,
      }}>
        <ActivityColumn
          track={track}
          position={position}
          activeNote={activeNote}
          onNoteClick={(n) => { setActiveNote(n.id); setPosition(n.t); }}
        />
        <MeterRail track={track} playing={playing} position={position} />
      </div>
    </div>
  );
}

// ── Track header ──────────────────────────────────────────────────────────

function TrackHeader({ track }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      marginBottom: 18,
    }}>
      <CoverArt hue={168} size="md" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>NOW PLAYING</span>
          <span className="dot" style={{ animation: 'pulseGlow 1.6s ease-in-out infinite' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{track.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{track.format}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="pill cyan">{track.genre.name} · {track.genre.confidence}%</span>
          <span className="pill"><span className="mono">{track.bpm}</span> BPM</span>
          <span className="pill"><span className="mono">{track.key}</span></span>
          <span className="pill violet">{track.loudness.integrated.toFixed(1)} LUFS</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <GradePill grade={track.grade} size="sm" />
        <button className="btn sm">+ Note</button>
        <button className="btn primary sm">View Report →</button>
      </div>
    </div>
  );
}

// ── Hero card: spectrum + transport ───────────────────────────────────────

function HeroCard({ track, playing, position, currentSection, onTogglePlay, onSeek, onHoverTime, hovering, activeNote, onNoteClick, tweak }) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const sectionColors = {
    intro: 'rgba(255,255,255,0.10)',
    buildup: 'rgba(0,229,176,0.32)',
    drop: 'rgba(251,146,60,0.55)',
    breakdown: 'rgba(167,139,250,0.45)',
    outro: 'rgba(255,255,255,0.10)',
  };

  return (
    <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
      {/* Floating overlay top-left — current section */}
      <div style={{
        position: 'absolute', top: 18, left: 22, zIndex: 5,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          padding: '6px 12px', borderRadius: 7,
          background: 'rgba(7,10,18,0.6)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(6px)',
        }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>SECTION</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sectionColors[currentSection.t] || 'var(--muted)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{currentSection.l}</span>
          </div>
        </div>
      </div>

      {/* Floating overlay top-right — live key metrics */}
      <div style={{
        position: 'absolute', top: 18, right: 22, zIndex: 5,
        display: 'flex', gap: 6,
      }}>
        <LivePill label="LUFS-S" value="-11.2" color="var(--cyan)" />
        <LivePill label="PEAK"   value="-0.6" color="var(--cyan)" />
        <LivePill label="CORR"   value="+0.71" color="var(--cyan)" />
      </div>

      {/* Spectrum hero */}
      <div style={{ position: 'relative', background: 'radial-gradient(ellipse 80% 60% at 50% 60%, rgba(0,229,176,0.08), transparent 65%)' }}>
        <SpectrumBars playing={playing} bpm={track.bpm} style={tweak.visualizer} height={380} />
        {/* tile-style frequency grid overlay */}
        <FreqGridOverlay />
      </div>

      {/* Transport row */}
      <div style={{ padding: '14px 22px 18px', borderTop: '1px solid var(--border)' }}>
        <ArrangementScrubber
          track={track}
          position={position}
          onSeek={onSeek}
          onHoverTime={onHoverTime}
          hovering={hovering}
          activeNote={activeNote}
          onNoteClick={onNoteClick}
          sectionColors={sectionColors}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
          <button onClick={onTogglePlay} style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'var(--cyan)', color: '#06151a',
            display: 'grid', placeItems: 'center',
            boxShadow: playing ? '0 0 24px rgba(0,229,176,0.6), 0 0 0 1px rgba(0,229,176,0.6)' : '0 0 12px rgba(0,229,176,0.3)',
            transition: 'box-shadow .2s',
          }}>
            <span style={{ fontSize: 14 }}>{playing ? '⏸' : '▶'}</span>
          </button>
          <button className="btn ghost sm" style={{ width: 36, height: 36, padding: 0, justifyContent: 'center' }}>⏮</button>
          <button className="btn ghost sm" style={{ width: 36, height: 36, padding: 0, justifyContent: 'center' }}>⏭</button>

          <div className="mono" style={{ fontSize: 12, color: 'var(--text-2)', minWidth: 100 }}>
            <span style={{ color: 'var(--cyan)' }}>{fmt(position)}</span>
            <span style={{ color: 'var(--muted)' }}> / {fmt(track.durationSec)}</span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            <SpeedDial />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>VOL</span>
              <div style={{ position: 'relative', width: 80, height: 4, background: 'var(--dim)', borderRadius: 2 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '78%', background: 'var(--cyan)', borderRadius: 2 }} />
              </div>
            </div>
            <button className="btn sm">EQ</button>
            <button className="btn sm">+ Note @ {Math.floor(position / 60)}:{String(Math.floor(position % 60)).padStart(2, '0')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LivePill({ label, value, color }) {
  return (
    <div style={{
      padding: '5px 10px', borderRadius: 6,
      background: 'rgba(7,10,18,0.6)',
      border: '1px solid var(--border)',
      backdropFilter: 'blur(6px)',
      display: 'flex', flexDirection: 'column', minWidth: 64,
    }}>
      <span className="mono" style={{ fontSize: 8, letterSpacing: '0.16em', color: 'var(--muted)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</span>
    </div>
  );
}

function FreqGridOverlay() {
  // Faint frequency lines + labels at the bottom of the hero
  const labels = [
    { hz: '50',   x: 6  },
    { hz: '120',  x: 14 },
    { hz: '250',  x: 25 },
    { hz: '500',  x: 38 },
    { hz: '1k',   x: 50 },
    { hz: '2k',   x: 62 },
    { hz: '4k',   x: 74 },
    { hz: '8k',   x: 86 },
    { hz: '16k',  x: 96 },
  ];
  return (
    <div style={{
      position: 'absolute', left: 22, right: 22, bottom: 12,
      pointerEvents: 'none',
      display: 'flex',
    }}>
      {labels.map(l => (
        <div key={l.hz} style={{ position: 'absolute', left: `${l.x}%`, transform: 'translateX(-50%)' }}>
          <span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.06em' }}>{l.hz}</span>
        </div>
      ))}
    </div>
  );
}

function SpeedDial() {
  const [speed, setSpeed] = useState(1.0);
  const speeds = [0.75, 1.0, 1.25, 1.5];
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, border: '1px solid var(--border)', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
      {speeds.map(s => (
        <button key={s} onClick={() => setSpeed(s)}
          className="mono" style={{
            fontSize: 10, fontWeight: 600,
            padding: '3px 8px', borderRadius: 4,
            color: s === speed ? 'var(--cyan)' : 'var(--muted)',
            background: s === speed ? 'rgba(0,229,176,0.10)' : 'transparent',
          }}>
          {s}×
        </button>
      ))}
    </div>
  );
}

// ── Arrangement scrubber — waveform + section stripe + comment markers ───

function ArrangementScrubber({ track, position, onSeek, onHoverTime, hovering, activeNote, onNoteClick, sectionColors }) {
  const ref = useRef(null);
  const dur = track.durationSec;
  const pct = position / dur;

  const total = track.arrangement.sections.reduce((s, x) => s + x.bars, 0);

  function handleClick(e) {
    const r = ref.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(p * dur);
  }
  function handleMove(e) {
    const r = ref.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onHoverTime({ t: p * dur, x: e.clientX - r.left });
  }

  // Pre-computed fake waveform shape
  const waveform = useMemo(() => {
    const arr = [];
    let acc = 0;
    for (const sec of track.arrangement.sections) {
      const baseAmp = sec.t === 'drop' ? 0.86 : sec.t === 'buildup' ? 0.55 : sec.t === 'breakdown' ? 0.35 : sec.t === 'intro' ? 0.28 : 0.34;
      const bars = sec.bars * 4; // sample density
      for (let i = 0; i < bars; i++) {
        const local = i / bars;
        let amp = baseAmp;
        if (sec.t === 'buildup') amp = baseAmp + local * 0.35;
        if (sec.t === 'breakdown') amp = baseAmp + (1 - local) * 0.15;
        if (sec.t === 'outro') amp = baseAmp * (1 - local * 0.7);
        const noise = (Math.sin(acc * 0.7) * 0.5 + 0.5) * 0.2 + (Math.sin(acc * 2.3) * 0.5 + 0.5) * 0.15;
        arr.push(Math.max(0.05, Math.min(1, amp + noise * 0.4 - 0.1)));
        acc++;
      }
    }
    return arr;
  }, [track]);

  // Section ribbon
  const ribbon = [];
  let p = 0;
  for (const sec of track.arrangement.sections) {
    const w = sec.bars / total;
    ribbon.push({ ...sec, x: p, w });
    p += w;
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Section ribbon */}
      <div style={{ position: 'relative', height: 14, display: 'flex', borderRadius: 4, overflow: 'hidden', marginBottom: 6, gap: 1 }}>
        {ribbon.map((sec, i) => (
          <div key={i} title={sec.l} style={{
            width: `${sec.w * 100}%`,
            background: sectionColors[sec.t] || 'rgba(255,255,255,0.06)',
            position: 'relative',
          }}>
            <span className="mono" style={{
              position: 'absolute', left: 6, top: 1,
              fontSize: 8, fontWeight: 600, color: 'rgba(255,255,255,0.78)',
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}>{sec.l}</span>
          </div>
        ))}
        {/* playhead on ribbon */}
        <div style={{
          position: 'absolute', top: -2, bottom: -2,
          left: `${pct * 100}%`, width: 2,
          background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Waveform */}
      <div
        ref={ref}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverTime(null)}
        style={{
          position: 'relative', height: 64,
          display: 'flex', alignItems: 'center', gap: 1,
          cursor: 'pointer', userSelect: 'none',
        }}>
        {waveform.map((v, i) => {
          const played = i / waveform.length <= pct;
          return (
            <div key={i} style={{
              flex: 1,
              height: `${v * 100}%`,
              background: played ? 'var(--cyan)' : 'rgba(255,255,255,0.13)',
              borderRadius: 1,
              boxShadow: played ? '0 0 2px rgba(0,229,176,0.3)' : 'none',
              transition: 'background 0.05s',
            }} />
          );
        })}
        {/* Playhead */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${pct * 100}%`, width: 2,
          background: 'white', opacity: 0.85,
          boxShadow: '0 0 8px rgba(0,229,176,0.8)',
          transform: 'translateX(-1px)', pointerEvents: 'none',
        }} />
        {/* Hover preview */}
        {hovering && (
          <div style={{
            position: 'absolute', bottom: '100%', marginBottom: 6,
            left: hovering.x, transform: 'translateX(-50%)',
            background: 'var(--card)', border: '1px solid var(--border)',
            padding: '3px 7px', borderRadius: 4,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
            color: 'var(--text-2)', whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {Math.floor(hovering.t / 60)}:{String(Math.floor(hovering.t % 60)).padStart(2, '0')}
          </div>
        )}
      </div>

      {/* Note markers — private session notes */}
      <div style={{ position: 'relative', height: 22, marginTop: 4 }}>
        {track.notes.map(n => {
          const cp = n.t / dur;
          const isActive = activeNote === n.id;
          const c = n.pinned ? 'var(--cyan)' : 'var(--violet)';
          return (
            <button key={n.id}
              onClick={() => onNoteClick(n)}
              title={n.text}
              style={{
                position: 'absolute', left: `${cp * 100}%`, top: 0,
                transform: 'translateX(-50%)',
                width: 16, height: 16, borderRadius: 4,
                background: c, color: '#06151a',
                display: 'grid', placeItems: 'center',
                fontSize: 9, fontWeight: 800,
                cursor: 'pointer',
                border: isActive ? '2px solid white' : '2px solid var(--bg)',
                boxShadow: isActive ? `0 0 14px ${c}` : `0 0 6px ${c}66`,
              }}>
              {n.pinned ? '★' : '·'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Tools rail — live audio tools (placeholder UI, real DSP in v1/v2) ────

const PREVIEW_TOOLS = [
  { id: 'eq',   label: 'Parametric EQ',  glyph: 'EQ', sub: '8 bands · BiquadFilter chain',         tier: 'v1', accent: 'var(--cyan)',   description: 'Peak / shelf / pass filters. Hear the AI Coach\'s EQ recipes applied live.' },
  { id: 'comp', label: 'Compressor',     glyph: '◧',  sub: 'Threshold / ratio / attack / release', tier: 'v1', accent: 'var(--orange)', description: 'DynamicsCompressor with auto-gain-match so louder ≠ better.' },
  { id: 'sat',  label: 'Saturation',     glyph: '∿',  sub: 'WaveShaper · tanh curve',              tier: 'v1', accent: 'var(--yellow)', description: 'Drive / soft clip for analog feel. 0–10 dB of pre-EQ saturation.' },
  { id: 'ms',   label: 'Width / M-S',    glyph: '⇔',  sub: 'Stereo width · mid / side gain',       tier: 'v1', accent: 'var(--violet)', description: 'Mid-side processing via channel splitter. Mono the bass under 120 Hz with one toggle.' },
  { id: 'lim',  label: 'Limiter',        glyph: '▲',  sub: 'True-peak · 4× oversampled',           tier: 'v2', accent: 'var(--red)',    description: 'AudioWorklet brickwall limiter. Marked v2 — for now, watch the peak meter and trust the ceiling.' },
  { id: 'pitch',label: 'Pitch · Tempo',  glyph: '♯',  sub: 'Signalsmith Stretch · WASM',           tier: 'v2', accent: 'var(--violet)', description: 'Phase-vocoder pitch shift + half-speed playback. Already in your codebase.' },
  { id: 'loop', label: 'Loop region',    glyph: '↻',  sub: 'WaveSurfer regions',                   tier: 'v1', accent: 'var(--cyan)',   description: 'Drag-select on the waveform to loop. Tweak EQ while one bar plays.' },
  { id: 'scope',label: 'Phase scope',    glyph: '◉',  sub: 'L/R vectorscope · correlation',        tier: 'v1', accent: 'var(--cyan)',   description: 'Live Lissajous + correlation needle. Spot phase issues at a glance.' },
];

function ToolsRail({ track }) {
  const [activeTool, setActiveTool] = useState(null);
  const [enabled, setEnabled]       = useState({});
  const [bypass, setBypass]         = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const [abMode, setAbMode]         = useState('B'); // 'A' = source, 'B' = with tools

  const activeCount = Object.values(enabled).filter(Boolean).length;

  function toggleTool(id) {
    setEnabled(e => ({ ...e, [id]: !e[id] }));
  }
  function resetAll() {
    setEnabled({});
    setBypass(false);
    setActiveTool(null);
  }

  return (
    <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="dot" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--cyan)', textTransform: 'uppercase', fontWeight: 700 }}>
            PREVIEW ADJUSTMENTS
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            {activeCount} of {PREVIEW_TOOLS.length} active
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ABSwitch mode={abMode} onChange={setAbMode} />
          <ChainToggle label="Bypass all" value={bypass} onChange={setBypass} />
          <ChainToggle label="Loudness-match" value={loudnessMatch} onChange={setLoudnessMatch} hint="Auto-compensate so A/B sounds at equal LUFS" />
          <button onClick={resetAll} className="btn ghost sm" style={{ color: 'var(--muted)' }}>↺ Reset</button>
        </div>
      </div>

      {/* Tile grid */}
      <div style={{
        padding: 14,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 10,
        opacity: bypass ? 0.55 : 1,
        transition: 'opacity .15s',
      }}>
        {PREVIEW_TOOLS.map(t => (
          <ToolTile
            key={t.id}
            tool={t}
            enabled={!!enabled[t.id] && !bypass}
            comingSoon={t.tier === 'v2'}
            active={activeTool === t.id}
            onToggle={() => toggleTool(t.id)}
            onSelect={() => setActiveTool(t.id === activeTool ? null : t.id)}
          />
        ))}
      </div>

      {/* Expanded tool placeholder */}
      {activeTool && (
        <ToolPlaceholderPanel
          tool={PREVIEW_TOOLS.find(t => t.id === activeTool)}
          onClose={() => setActiveTool(null)}
        />
      )}

      {/* Footer note */}
      <div style={{
        padding: '10px 20px',
        borderTop: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.012)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
          ⓘ Adjustments are temporary — they affect playback only. Your mix file stays untouched.
        </span>
        <button className="btn ghost sm" style={{ marginLeft: 'auto', color: 'var(--cyan)', fontSize: 10 }}>
          Save chain as preset
        </button>
      </div>
    </div>
  );
}

function ABSwitch({ mode, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2, borderRadius: 7,
      border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)',
    }}>
      {['A', 'B'].map(m => (
        <button key={m} onClick={() => onChange(m)} className="mono" style={{
          width: 36, padding: '4px 0', borderRadius: 5,
          fontSize: 11, fontWeight: 700,
          color: mode === m ? 'var(--text)' : 'var(--muted)',
          background: mode === m ? (m === 'A' ? 'var(--card-hover)' : 'rgba(0,229,176,0.10)') : 'transparent',
          letterSpacing: '0.06em',
        }} title={m === 'A' ? 'Source (no tools)' : 'With tool chain applied'}>
          {m}
        </button>
      ))}
    </div>
  );
}

function ChainToggle({ label, value, onChange, hint }) {
  return (
    <button onClick={() => onChange(!value)} title={hint}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '5px 11px', borderRadius: 7,
        background: value ? 'rgba(0,229,176,0.06)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${value ? 'rgba(0,229,176,0.32)' : 'var(--border)'}`,
        color: value ? 'var(--cyan)' : 'var(--text-2)',
        fontSize: 11, fontWeight: 600,
      }}>
      <span style={{
        width: 22, height: 12, borderRadius: 999,
        background: value ? 'var(--cyan)' : 'var(--dim)',
        position: 'relative', flexShrink: 0,
        transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: value ? 12 : 2,
          width: 8, height: 8, borderRadius: '50%',
          background: value ? '#06151a' : 'rgba(255,255,255,0.5)',
          transition: 'left .15s',
        }} />
      </span>
      {label}
    </button>
  );
}

function ToolTile({ tool, enabled, comingSoon, active, onToggle, onSelect }) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: 12,
        background: enabled ? `${tool.accent}08` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${enabled ? `${tool.accent}40` : active ? 'var(--border-2)' : 'var(--border)'}`,
        borderRadius: 9,
        cursor: 'pointer',
        transition: 'background .15s, border-color .15s',
        display: 'flex', flexDirection: 'column', gap: 8,
        position: 'relative',
        minHeight: 92,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: enabled ? `${tool.accent}1a` : 'rgba(255,255,255,0.025)',
          border: `1px solid ${enabled ? `${tool.accent}66` : 'var(--border)'}`,
          color: enabled ? tool.accent : 'var(--muted)',
          display: 'grid', placeItems: 'center',
          fontWeight: 700, fontSize: 12,
          fontFamily: 'JetBrains Mono, monospace',
          flexShrink: 0,
        }}>{tool.glyph}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: enabled ? 'var(--text)' : 'var(--text-2)' }}>{tool.label}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.sub}</div>
        </div>
        {/* Inline toggle */}
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
          disabled={comingSoon}
          style={{
            width: 28, height: 16, borderRadius: 999,
            background: enabled ? tool.accent : 'var(--dim)',
            border: 'none',
            position: 'relative',
            cursor: comingSoon ? 'not-allowed' : 'pointer',
            opacity: comingSoon ? 0.4 : 1,
            flexShrink: 0,
            transition: 'background .15s',
          }}>
          <span style={{
            position: 'absolute', top: 2, left: enabled ? 14 : 2,
            width: 12, height: 12, borderRadius: '50%',
            background: enabled ? '#06151a' : 'rgba(255,255,255,0.5)',
            transition: 'left .15s',
          }} />
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
        <span className="mono" style={{
          fontSize: 8, padding: '1px 6px', borderRadius: 4,
          background: comingSoon ? 'rgba(167,139,250,0.08)' : 'rgba(0,229,176,0.06)',
          border: `1px solid ${comingSoon ? 'rgba(167,139,250,0.32)' : 'rgba(0,229,176,0.22)'}`,
          color: comingSoon ? 'var(--violet)' : 'var(--cyan)',
          fontWeight: 700, letterSpacing: '0.06em',
        }}>{comingSoon ? 'V2 SOON' : 'V1'}</span>
        {enabled && (
          <span className="mono" style={{ fontSize: 8, color: tool.accent, letterSpacing: '0.10em', fontWeight: 700 }}>● ACTIVE</span>
        )}
        <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginLeft: 'auto' }}>
          {active ? 'open ↑' : 'open ↓'}
        </span>
      </div>
    </div>
  );
}

function ToolPlaceholderPanel({ tool, onClose }) {
  return (
    <div style={{
      margin: '0 14px 14px',
      padding: 16,
      borderRadius: 10,
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${tool.accent}28`,
      borderLeft: `3px solid ${tool.accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 5,
          background: `${tool.accent}1a`, border: `1px solid ${tool.accent}66`,
          color: tool.accent, display: 'grid', placeItems: 'center',
          fontWeight: 700, fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
        }}>{tool.glyph}</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{tool.label}</span>
        <span className="mono" style={{ fontSize: 9, color: tool.accent, letterSpacing: '0.10em' }}>{tool.tier === 'v2' ? 'COMING SOON' : 'PLACEHOLDER UI'}</span>
        <button onClick={onClose} className="btn ghost sm" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>− Collapse</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.55 }}>{tool.description}</div>

      {/* Tool-specific placeholder UI */}
      {tool.id === 'eq' &&    <PlaceholderEQ accent={tool.accent} />}
      {tool.id === 'comp' &&  <PlaceholderComp accent={tool.accent} />}
      {tool.id === 'sat' &&   <PlaceholderSat accent={tool.accent} />}
      {tool.id === 'ms' &&    <PlaceholderWidth accent={tool.accent} />}
      {tool.id === 'lim' &&   <PlaceholderLim accent={tool.accent} />}
      {tool.id === 'pitch' && <PlaceholderPitch accent={tool.accent} />}
      {tool.id === 'loop' &&  <PlaceholderLoop accent={tool.accent} />}
      {tool.id === 'scope' && <PlaceholderScope accent={tool.accent} />}
    </div>
  );
}

// ── Per-tool placeholder UIs ──────────────────────────────────────────────

function PlaceholderEQ({ accent }) {
  // Visualize 8-band EQ curve as static SVG with knob dots
  const bands = [
    { hz: '60',  gain: 2,  q: 0.7 },
    { hz: '120', gain: 0,  q: 1.0 },
    { hz: '250', gain: -1, q: 1.4 },
    { hz: '500', gain: 0,  q: 1.0 },
    { hz: '1k',  gain: 0,  q: 1.0 },
    { hz: '2k',  gain: 0,  q: 1.0 },
    { hz: '4k',  gain: 0,  q: 1.0 },
    { hz: '12k', gain: 2,  q: 0.7 },
  ];
  const W = 600, H = 96;
  return (
    <div style={{ background: 'rgba(7,10,18,0.4)', borderRadius: 8, padding: 12 }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="3 3" />
        {/* Curve approximation */}
        <path d={`M 0 ${H/2} ${bands.map((b, i) => {
          const x = (i / (bands.length - 1)) * W;
          const y = H/2 - b.gain * 6;
          return `L ${x} ${y}`;
        }).join(' ')} L ${W} ${H/2}`} stroke={accent} strokeWidth="2" fill="none" />
        <path d={`M 0 ${H/2} ${bands.map((b, i) => {
          const x = (i / (bands.length - 1)) * W;
          const y = H/2 - b.gain * 6;
          return `L ${x} ${y}`;
        }).join(' ')} L ${W} ${H/2} L 0 ${H/2} Z`} fill={accent} opacity="0.12" />
        {bands.map((b, i) => {
          const x = (i / (bands.length - 1)) * W;
          const y = H/2 - b.gain * 6;
          return <circle key={i} cx={x} cy={y} r="3.5" fill={accent} />;
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {bands.map((b, i) => (
          <span key={i} className="mono" style={{ fontSize: 9, color: b.gain !== 0 ? accent : 'var(--muted)' }}>
            {b.hz}{b.gain ? ` ${b.gain > 0 ? '+' : ''}${b.gain}dB` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlaceholderComp({ accent }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {[
        { label: 'Threshold', value: '-18.0', unit: 'dB' },
        { label: 'Ratio',     value: '4:1',   unit: '' },
        { label: 'Attack',    value: '10',    unit: 'ms' },
        { label: 'Release',   value: '120',   unit: 'ms' },
      ].map(k => (
        <div key={k.label} style={{ padding: '10px 12px', background: 'rgba(7,10,18,0.4)', border: '1px solid var(--border)', borderRadius: 7 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>{k.label}</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: accent, marginTop: 4 }}>
            {k.value}<span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 3 }}>{k.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaceholderSat({ accent }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 12, alignItems: 'center' }}>
      <div>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 6 }}>DRIVE</div>
        <div style={{ position: 'relative', height: 4, background: 'var(--dim)', borderRadius: 2 }}>
          <div style={{ position: 'absolute', height: '100%', width: '32%', background: accent, borderRadius: 2 }} />
          <div style={{ position: 'absolute', top: '50%', left: '32%', width: 14, height: 14, borderRadius: '50%', background: accent, transform: 'translate(-50%, -50%)', boxShadow: `0 0 8px ${accent}` }} />
        </div>
        <div className="mono" style={{ fontSize: 11, color: accent, marginTop: 6 }}>+3.2 dB · tanh</div>
      </div>
      <svg width="200" height="60" viewBox="-50 -50 100 100" style={{ background: 'rgba(7,10,18,0.4)', borderRadius: 7 }}>
        <line x1="-50" y1="0" x2="50" y2="0" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <line x1="0" y1="-50" x2="0" y2="50" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <path d="M -50 30 Q -25 25 0 0 Q 25 -25 50 -30" stroke={accent} strokeWidth="2" fill="none" />
      </svg>
    </div>
  );
}

function PlaceholderWidth({ accent }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 6 }}>STEREO WIDTH</div>
        <div style={{ position: 'relative', height: 6, background: 'var(--dim)', borderRadius: 3 }}>
          <div style={{ position: 'absolute', height: '100%', width: '50%', background: 'rgba(255,255,255,0.05)', borderRadius: 3 }} />
          <div style={{ position: 'absolute', height: '100%', width: '62%', background: accent, borderRadius: 3, boxShadow: `0 0 6px ${accent}66` }} />
        </div>
        <div className="mono" style={{ fontSize: 11, color: accent, marginTop: 6 }}>62% · mono &lt; 120 Hz off</div>
      </div>
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 6 }}>MID / SIDE BALANCE</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ flex: 0.55, height: 16, background: accent, borderRadius: 3, display: 'grid', placeItems: 'center', fontSize: 9, color: '#06151a', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>MID 55%</div>
          <div style={{ flex: 0.45, height: 16, background: 'var(--violet)', borderRadius: 3, display: 'grid', placeItems: 'center', fontSize: 9, color: '#06151a', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>SIDE 45%</div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderLim({ accent }) {
  return (
    <div style={{
      padding: 12, borderRadius: 8,
      background: 'rgba(244,63,94,0.04)',
      border: '1px dashed rgba(244,63,94,0.32)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ fontSize: 20, color: accent }}>▲</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: accent }}>True-peak limiter — v2</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
          AudioWorkletNode w/ 4× oversampling. ~150 lines of inter-sample DSP. Until then, the peak meter shows you the ceiling — but no brickwall is enforced.
        </div>
      </div>
      <span className="pill violet">deferred</span>
    </div>
  );
}

function PlaceholderPitch({ accent }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {[
        { label: 'Semitones', value: '0',   unit: 'st' },
        { label: 'Cents',     value: '+0',  unit: '¢' },
        { label: 'Speed',     value: '1.0', unit: '×' },
      ].map(k => (
        <div key={k.label} style={{ padding: '10px 12px', background: 'rgba(7,10,18,0.4)', border: '1px solid var(--border)', borderRadius: 7 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>{k.label}</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: accent, marginTop: 4 }}>
            {k.value}<span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 3 }}>{k.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaceholderLoop({ accent }) {
  return (
    <div style={{ padding: 10, background: 'rgba(7,10,18,0.4)', borderRadius: 8 }}>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 8 }}>LOOP REGION</div>
      <div style={{ position: 'relative', height: 36, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
        {Array.from({ length: 80 }).map((_, i) => {
          const v = 0.3 + (Math.sin(i * 0.4) * 0.5 + 0.5) * 0.7;
          const inLoop = i >= 32 && i < 52;
          return <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: inLoop ? accent : 'rgba(255,255,255,0.15)', borderRadius: 1, opacity: inLoop ? 0.85 : 1 }} />;
        })}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: '40%', right: '35%',
          border: `1px solid ${accent}`,
          background: `${accent}10`,
          borderRadius: 4,
          pointerEvents: 'none',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 10, color: accent }}>loop 1:24 → 1:46 · 22.0s</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>drag-select to change</span>
      </div>
    </div>
  );
}

function PlaceholderScope({ accent }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
      <div style={{ aspectRatio: 1, background: 'rgba(7,10,18,0.4)', border: '1px solid var(--border)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}>
        {/* Goniometer style display */}
        <svg width="100%" height="100%" viewBox="-50 -50 100 100">
          <line x1="-50" y1="0" x2="50" y2="0" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <line x1="0" y1="-50" x2="0" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <line x1="-35" y1="-35" x2="35" y2="35" stroke={accent} strokeOpacity="0.16" strokeWidth="0.5" />
          <line x1="-35" y1="35" x2="35" y2="-35" stroke={accent} strokeOpacity="0.16" strokeWidth="0.5" />
          {Array.from({ length: 28 }).map((_, i) => {
            const a = (i / 28) * Math.PI * 2;
            const r = 18 + (Math.sin(a * 3) * 8 + Math.sin(a * 5.7) * 4);
            return <circle key={i} cx={Math.cos(a) * r} cy={Math.sin(a) * r * 0.55} r="0.9" fill={accent} opacity="0.7" />;
          })}
        </svg>
      </div>
      <div>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', marginBottom: 8 }}>CORRELATION</div>
        <div style={{ position: 'relative', height: 14, background: 'var(--dim)', borderRadius: 4 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: 'rgba(244,63,94,0.05)' }} />
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '50%', background: 'rgba(0,229,176,0.05)' }} />
          <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'rgba(255,255,255,0.20)' }} />
          <div style={{ position: 'absolute', top: '50%', left: '85%', width: 12, height: 12, borderRadius: '50%', background: accent, transform: 'translate(-50%, -50%)', boxShadow: `0 0 8px ${accent}` }} />
        </div>
        <div className="mono" style={{ fontSize: 11, color: accent, marginTop: 6 }}>+0.71 — healthy</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
          L/R Lissajous · vertical line = mono · horizontal = out-of-phase
        </div>
      </div>
    </div>
  );
}

// ── Activity column (left) ────────────────────────────────────────────────

function ActivityColumn({ track, position, activeNote, onNoteClick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <NotesCard track={track} activeNote={activeNote} onNoteClick={onNoteClick} position={position} />
      <TrackContextCard track={track} />
    </div>
  );
}

function NotesCard({ track, activeNote, onNoteClick, position }) {
  const [text, setText] = useState('');
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--cyan)" style={{ marginBottom: 0 }}>
          Session notes · <span style={{ color: 'var(--text-2)' }}>{track.notes.length}</span>
        </SectionTitle>
        <span className="pill" style={{ background: 'rgba(255,255,255,0.025)', color: 'var(--muted)' }}>Private to you</span>
      </div>
      <div style={{ padding: '8px 8px 14px' }}>
        {track.notes.map(n => {
          const isActive = activeNote === n.id;
          const c = n.pinned ? 'var(--cyan)' : 'var(--violet)';
          return (
            <button key={n.id} onClick={() => onNoteClick(n)}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', gap: 12, padding: '10px 14px',
                borderRadius: 8,
                background: isActive ? 'rgba(0,229,176,0.05)' : 'transparent',
                border: isActive ? '1px solid rgba(0,229,176,0.32)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'background .15s',
              }}>
              <div style={{
                width: 32, height: 32, borderRadius: 7,
                background: `${c}14`, border: `1px solid ${c}44`,
                color: c, display: 'grid', placeItems: 'center',
                fontSize: 14, flexShrink: 0,
              }}>
                {n.pinned ? '★' : '·'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 10, color: c, letterSpacing: '0.06em' }}>@{fmt(n.t)}</span>
                  {n.pinned && <span className="mono" style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>PINNED</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45 }}>{n.text}</div>
              </div>
            </button>
          );
        })}
        {/* New note input */}
        <div style={{
          margin: '8px 8px 0',
          padding: '10px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'rgba(0,229,176,0.10)', border: '1px solid rgba(0,229,176,0.32)',
            color: 'var(--cyan)',
            display: 'grid', placeItems: 'center', fontSize: 14,
          }}>+</span>
          <input value={text} onChange={e => setText(e.target.value)}
            placeholder="Note this moment for later…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
            }} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)' }}>@ {fmt(position)}</span>
          <button className="btn sm primary" style={{ padding: '4px 10px', fontSize: 11 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function TrackContextCard({ track }) {
  // Quick-reference DNA for the producer themselves
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--cyan)">Track DNA</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <PlainStat icon="●" label="Mood"   value="Driving, hopeful" />
        <PlainStat icon="◷" label="Tempo"  value="Mid-fast" sub="128 BPM" />
        <PlainStat icon="◐" label="Energy" value="High" sub="82/100" />
        <PlainStat icon="♪" label="Key"    value="F# minor" />
        <PlainStat icon="⌖" label="Drops"  value="2" sub="56 & 196" />
        <PlainStat icon="◌" label="Vocals" value="Instrumental" />
      </div>
      <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.18)' }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--violet)', textTransform: 'uppercase', marginBottom: 6 }}>DNA COMPONENTS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {track.tranceDNA.parts.map((p, i) => (
            <span key={i} className="mono" style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
            }}>{p}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlainStat({ icon, label, value, sub, tone }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.018)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: tone || 'var(--muted)' }}>{icon}</span>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: tone || 'var(--text)', marginTop: 4 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Meter rail (right) ────────────────────────────────────────────────────

function MeterRail({ track, playing, position }) {
  // Animated short-term LUFS value (just an aesthetic loop)
  const [stLufs, setStLufs] = useState(-11.2);
  useEffect(() => {
    if (!playing) { setStLufs(track.loudness.integrated); return; }
    let raf, t0 = performance.now() / 1000;
    function frame() {
      const t = performance.now() / 1000 - t0;
      const wobble = Math.sin(t * 1.7) * 0.6 + Math.sin(t * 4.3) * 0.3;
      setStLufs(track.loudness.integrated + wobble);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, track.loudness.integrated]);

  const [peakHold, setPeakHold] = useState(-0.6);
  const [correlation, setCorrelation] = useState(0.71);
  useEffect(() => {
    if (!playing) return;
    let raf, t0 = performance.now() / 1000;
    function frame() {
      const t = performance.now() / 1000 - t0;
      setPeakHold(-0.6 + Math.sin(t * 1.4) * 0.25);
      setCorrelation(0.71 + Math.sin(t * 0.8) * 0.08);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card card-body">
        <SectionTitle accent="var(--cyan)" right={<span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>LIVE</span>}>
          Live meters
        </SectionTitle>

        <MeterRow label="Short-term LUFS" value={stLufs.toFixed(1)} unit="LUFS" target={-14} range={[-30, 0]} subRight="target -14">
          <LufsMeter value={stLufs} target={-14} range={[-30, 0]} />
        </MeterRow>

        <MeterRow label="True peak" value={peakHold.toFixed(1)} unit="dBTP" target={-1} range={[-12, 0]} subRight="ceiling -1">
          <LufsMeter value={peakHold} target={-1} range={[-12, 0]} />
        </MeterRow>

        <MeterRow label="Correlation" value={correlation.toFixed(2)} unit="" target={null} range={[-1, 1]} subRight="L/R phase">
          <CorrelationBar value={correlation} />
        </MeterRow>

        <MeterRow label="Stereo width" value="62" unit="%" target={null} range={[0, 100]} subRight="">
          <WidthBlock value={62} />
        </MeterRow>
      </div>

      <FrequencyTiltCard track={track} playing={playing} />

      <SimilarTracksCard />
    </div>
  );
}

function MeterRow({ label, value, unit, subRight, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <div>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--cyan)' }}>{value}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>{unit}</span>
          {subRight && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginLeft: 8 }}>{subRight}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

function CorrelationBar({ value }) {
  const pct = (value + 1) / 2;
  const col = value < 0 ? 'var(--red)' : value < 0.3 ? 'var(--orange)' : 'var(--cyan)';
  return (
    <div style={{ position: 'relative', height: 14, background: 'var(--dim)', borderRadius: 4 }}>
      {/* zones */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: 'rgba(244,63,94,0.06)', borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, right: 0, background: 'rgba(0,229,176,0.06)', borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
      {/* center line */}
      <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'rgba(255,255,255,0.18)' }} />
      <div style={{
        position: 'absolute', left: `${pct * 100}%`, top: '50%',
        width: 12, height: 12, borderRadius: '50%',
        background: col, transform: 'translate(-50%, -50%)',
        boxShadow: `0 0 8px ${col}88`,
        transition: 'left 0.18s linear',
      }} />
    </div>
  );
}

function WidthBlock({ value }) {
  const segments = 20;
  const filled = Math.round((value / 100) * segments);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} style={{
          flex: 1, height: 14,
          background: i < filled ? (i < 8 ? 'var(--cyan)' : i < 16 ? 'var(--cyan)' : 'var(--yellow)') : 'var(--dim)',
          borderRadius: 1,
          opacity: i < filled ? 0.85 - (i / segments) * 0.3 : 1,
        }} />
      ))}
    </div>
  );
}

function FrequencyTiltCard({ track, playing }) {
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--cyan)">Frequency tilt</SectionTitle>
      <MiniSpectrum playing={playing} bpm={track.bpm} height={56} bars={28} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>20Hz</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--orange)' }}>↑ bass-heavy</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>20kHz</span>
      </div>
    </div>
  );
}

function SimilarTracksCard() {
  const tracks = [
    { name: 'Voidcaller — v5',   sub: 'A · 138 BPM', hue: 220 },
    { name: 'Gridline — v6',     sub: 'B+ · 130 BPM', hue: 145 },
    { name: 'Postcard — v2',     sub: 'A · 90 BPM',  hue: 320 },
  ];
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--violet)">From your library · similar feel</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tracks.map((t, i) => (
          <button key={i} style={{
            display: 'flex', gap: 10, alignItems: 'center',
            padding: 8, borderRadius: 8,
            background: 'transparent', textAlign: 'left',
            transition: 'background .15s',
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'var(--card-hover)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
            <CoverArt hue={t.hue} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{t.sub}</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>▶</span>
          </button>
        ))}
      </div>
    </div>
  );
}

window.NowPlaying = NowPlaying;
