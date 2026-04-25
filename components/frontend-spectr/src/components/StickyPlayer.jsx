import { useState, useEffect, useRef, useCallback } from 'react';
import SignalsmithStretch from 'signalsmith-stretch';
import { useWaveform } from '../hooks/useWaveform';
import EQPanel, { EQ_BANDS } from './EQPanel';
import CompressorPanel from './CompressorPanel';
import PitchPanel from './PitchPanel';

const fmt = (secs) => {
  if (!secs || isNaN(secs)) return '0:00';
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
};

const PANEL_WIDTHS = { eq: 'min(580px,100vw)', comp: 'min(520px,100vw)', pitch: 'min(300px,100vw)' };
const PANEL_COLORS = { eq: '#f59e0b', comp: 'var(--orange)', pitch: 'var(--violet)' };

export default function StickyPlayer({ file }) {
  const waveRef = useRef();

  const [playing,     setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [volume,      setVolume]      = useState(0.8);
  const [activePanel, setActivePanel] = useState(null);
  const [expandPanel, setExpandPanel] = useState(false);
  const [semitones,   setSemitones]   = useState(0);
  const [cents,       setCents]       = useState(0);
  const [graphBuilt,  setGraphBuilt]  = useState(false);

  // Permanent Web Audio graph nodes
  const actxRef        = useRef(null);
  const filtersRef     = useRef([]);
  const analyserRef    = useRef(null);
  const compRef        = useRef(null);
  const makeupGainRef  = useRef(null);
  const volGainRef     = useRef(null);

  // Playback state
  const audioBufferRef = useRef(null);  // decoded AudioBuffer — always present
  const stretchRef     = useRef(null);  // SignalsmithStretch node — optional, may be null
  const sourceRef      = useRef(null);  // AudioBufferSourceNode for fallback
  const sourceIdRef    = useRef(0);
  const startedAtRef   = useRef(0);
  const offsetRef      = useRef(0);
  const timerRef       = useRef(null);
  const semRef         = useRef(0);
  const centsRef       = useRef(0);
  const playingRef     = useRef(false);
  const useStretchRef  = useRef(false); // true when stretch node is ready

  useEffect(() => { semRef.current     = semitones; }, [semitones]);
  useEffect(() => { centsRef.current   = cents;     }, [cents]);
  useEffect(() => { playingRef.current = playing;   }, [playing]);

  const { waveform, loading } = useWaveform(file, 220);

  useEffect(() => { if (file) setActivePanel('eq'); }, [file]);

  const ensureGraph = useCallback(() => {
    if (actxRef.current) return actxRef.current;

    const Ctx  = window.AudioContext || window.webkitAudioContext;
    const actx = new Ctx();
    actxRef.current = actx;

    const filters = EQ_BANDS.map(({ type, freq, Q }) => {
      const f = actx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = Q; f.gain.value = 0;
      return f;
    });
    filtersRef.current = filters;

    const analyser = actx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 8;
    comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.2;
    compRef.current = comp;

    const makeup = actx.createGain(); makeup.gain.value = 1;
    makeupGainRef.current = makeup;

    const volGain = actx.createGain(); volGain.gain.value = 0.8;
    volGainRef.current = volGain;

    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(analyser);
    analyser.connect(comp);
    comp.connect(makeup);
    makeup.connect(volGain);
    volGain.connect(actx.destination);

    setGraphBuilt(true);
    return actx;
  }, []);

  // Decode file → AudioBuffer. Also try to init the stretch node for tempo-safe pitch.
  useEffect(() => {
    if (!file) return;

    // Stop current playback
    sourceIdRef.current++;
    clearInterval(timerRef.current);
    if (stretchRef.current) { try { stretchRef.current.stop(); } catch (_) {} }
    if (sourceRef.current)  { try { sourceRef.current.stop();  } catch (_) {} sourceRef.current = null; }
    offsetRef.current = 0;
    useStretchRef.current = false;
    setCurrentTime(0);
    setPlaying(false);
    playingRef.current = false;

    const actx = ensureGraph();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        if (actx.state === 'closed') return;

        const buffer = await actx.decodeAudioData(e.target.result.slice(0));
        audioBufferRef.current = buffer;
        setDuration(buffer.duration);

        // Attempt to create / reuse the SignalsmithStretch node (may fail — handled below)
        try {
          if (!stretchRef.current) {
            const node = await SignalsmithStretch(actx);
            node.connect(filtersRef.current[0] ?? actx.destination);
            stretchRef.current = node;
          } else {
            stretchRef.current.dropBuffers();
          }

          const channels = [];
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            channels.push(buffer.getChannelData(ch).slice(0));
          }
          await stretchRef.current.addBuffers(channels);
          useStretchRef.current = true; // stretch is ready
        } catch (stretchErr) {
          console.warn('[StickyPlayer] stretch unavailable, using fallback:', stretchErr);
          stretchRef.current    = null;
          useStretchRef.current = false;
        }
      } catch (err) {
        console.error('[StickyPlayer] decode error:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [file, ensureGraph]);

  useEffect(() => {
    if (volGainRef.current) volGainRef.current.gain.value = volume;
  }, [volume]);

  // Live pitch — stretch handles it without restart; fallback restarts source
  useEffect(() => {
    if (!playingRef.current) return;
    if (useStretchRef.current && stretchRef.current) {
      stretchRef.current.schedule({ semitones: semitones + cents / 100 });
    } else if (sourceRef.current) {
      sourceRef.current.detune.value = (semitones * 100) + cents;
    }
  }, [semitones, cents]);

  // Cleanup — null refs so StrictMode double-mount recreates the graph cleanly
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (stretchRef.current) { try { stretchRef.current.stop(); } catch (_) {} }
      if (sourceRef.current)  { try { sourceRef.current.stop();  } catch (_) {} }
      actxRef.current?.close();
      actxRef.current       = null;
      stretchRef.current    = null;
      sourceRef.current     = null;
      audioBufferRef.current = null;
      filtersRef.current    = [];
      analyserRef.current   = null;
      compRef.current       = null;
      makeupGainRef.current = null;
      volGainRef.current    = null;
      useStretchRef.current = false;
    };
  }, []);

  const startPlayback = useCallback(async () => {
    const actx = actxRef.current;
    if (!actx || actx.state === 'closed') return;
    if (!audioBufferRef.current && !stretchRef.current) return;

    if (actx.state !== 'running') {
      try { await actx.resume(); } catch (_) {}
    }

    const pitchSt = semRef.current + centsRef.current / 100;

    if (useStretchRef.current && stretchRef.current) {
      // ── Tempo-safe pitch shift via WASM phase vocoder ──
      stretchRef.current.start(0, offsetRef.current, undefined, 1.0, pitchSt);
      setPlaying(true);
      playingRef.current = true;

      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (!stretchRef.current || !playingRef.current) return;
        const t   = stretchRef.current.inputTime;
        const dur = audioBufferRef.current?.duration ?? 0;
        if (dur <= 0) return;
        setCurrentTime(Math.min(t, dur));
        if (t >= dur - 0.05) {
          stretchRef.current.stop();
          clearInterval(timerRef.current);
          offsetRef.current = 0;
          setCurrentTime(0);
          setPlaying(false);
          playingRef.current = false;
        }
      }, 50);

    } else if (audioBufferRef.current) {
      // ── Fallback: AudioBufferSourceNode (detune changes tempo too) ──
      const buffer = audioBufferRef.current;
      const src    = actx.createBufferSource();
      src.buffer       = buffer;
      src.detune.value = pitchSt * 100;
      src.connect(filtersRef.current[0] ?? actx.destination);

      const myId = ++sourceIdRef.current;
      src.onended = () => {
        if (sourceIdRef.current !== myId) return;
        clearInterval(timerRef.current);
        offsetRef.current = 0;
        setCurrentTime(0);
        setPlaying(false);
        playingRef.current = false;
      };

      src.start(0, Math.min(offsetRef.current, buffer.duration - 0.001));
      sourceRef.current    = src;
      startedAtRef.current = actx.currentTime;
      setPlaying(true);
      playingRef.current = true;

      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (!actxRef.current || !audioBufferRef.current) return;
        const t = offsetRef.current + (actxRef.current.currentTime - startedAtRef.current);
        setCurrentTime(Math.min(t, audioBufferRef.current.duration));
      }, 50);
    }
  }, []);

  const pausePlayback = useCallback(() => {
    clearInterval(timerRef.current);

    if (useStretchRef.current && stretchRef.current) {
      offsetRef.current = stretchRef.current.inputTime;
      stretchRef.current.stop();
    } else if (actxRef.current && sourceRef.current) {
      sourceIdRef.current++;
      offsetRef.current += actxRef.current.currentTime - startedAtRef.current;
      try { sourceRef.current.stop(); } catch (_) {}
      sourceRef.current = null;
    }

    setPlaying(false);
    playingRef.current = false;
    setCurrentTime(offsetRef.current);
  }, []);

  const togglePlay = useCallback(() => {
    if (playingRef.current) pausePlayback();
    else startPlayback();
  }, [pausePlayback, startPlayback]);

  const seek = useCallback(async (e) => {
    const dur = audioBufferRef.current?.duration ?? 0;
    if (!dur || !waveRef.current) return;
    const rect    = waveRef.current.getBoundingClientRect();
    const pct     = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pct * dur;
    const was     = playingRef.current;

    // Stop current playback
    clearInterval(timerRef.current);
    sourceIdRef.current++;
    if (useStretchRef.current && stretchRef.current) {
      try { stretchRef.current.stop(); } catch (_) {}
    } else if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch (_) {}
      sourceRef.current = null;
    }
    setPlaying(false);
    playingRef.current = false;

    offsetRef.current = newTime;
    setCurrentTime(newTime);

    if (was) await startPlayback();
  }, [startPlayback]);

  const togglePanel = useCallback((name) => {
    setActivePanel(prev => prev === name ? null : name);
    setExpandPanel(false);
  }, []);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    setExpandPanel(false);
  }, []);

  const progress  = duration ? currentTime / duration : 0;
  const shortName = file?.name.replace(/\.[^/.]+$/, '') ?? '';

  return (
    <>
      {/* Floating panel */}
      {activePanel && (
        <div style={{
          position: 'fixed',
          ...(expandPanel
            ? { top: 0, bottom: 65, left: 0, right: 0 }
            : { bottom: 65, right: 0, width: PANEL_WIDTHS[activePanel] }
          ),
          zIndex: 199,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          borderRadius: expandPanel ? 0 : '12px 12px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {activePanel === 'eq' && (
            <EQPanel
              filterNodes={graphBuilt ? filtersRef.current : []}
              analyserNode={graphBuilt ? analyserRef.current : null}
              playing={playing}
              canvasHeight={expandPanel ? 300 : 180}
              isExpanded={expandPanel}
              onToggleExpand={() => setExpandPanel(v => !v)}
              onClose={closePanel}
            />
          )}
          {activePanel === 'comp' && (
            <CompressorPanel
              compNode={graphBuilt ? compRef.current : null}
              gainNode={graphBuilt ? makeupGainRef.current : null}
              canvasHeight={expandPanel ? 260 : 180}
              isExpanded={expandPanel}
              onToggleExpand={() => setExpandPanel(v => !v)}
              onClose={closePanel}
            />
          )}
          {activePanel === 'pitch' && (
            <PitchPanel
              semitones={semitones}
              onSemitonesChange={setSemitones}
              cents={cents}
              onCentsChange={setCents}
              canvasHeight={expandPanel ? 200 : 160}
              isExpanded={expandPanel}
              onToggleExpand={() => setExpandPanel(v => !v)}
              onClose={closePanel}
            />
          )}
        </div>
      )}

      {/* Sticky player bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        background: 'rgba(7,10,18,0.97)',
        backdropFilter: 'blur(18px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '10px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'var(--cyan)', color: '#070a12', cursor: 'pointer',
            fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: playing ? '0 0 20px rgba(0,229,176,0.55)' : '0 0 8px rgba(0,229,176,0.2)',
            transition: 'box-shadow 0.25s',
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        {/* Track info */}
        <div style={{ minWidth: 120, flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
            {shortName}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {fmt(currentTime)} / {fmt(duration)}
          </div>
        </div>

        {/* Waveform scrubber */}
        <div
          ref={waveRef}
          onClick={seek}
          style={{ flex: 1, height: 44, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none', position: 'relative' }}
        >
          {loading && (
            <div className="mono" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>
              loading waveform…
            </div>
          )}
          {(waveform ?? Array.from({ length: 220 }, (_, i) => 0.15 + Math.abs(Math.sin(i * 0.15) * 0.35))).map((v, i) => {
            const played = i / 220 <= progress;
            return (
              <div key={i} style={{
                flex: 1, height: `${Math.max(6, v * 100)}%`,
                background: played ? 'var(--cyan)' : 'rgba(255,255,255,0.1)',
                borderRadius: 1, transition: 'background 0.04s',
                boxShadow: played ? '0 0 2px rgba(0,229,176,0.3)' : 'none',
              }} />
            );
          })}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${progress * 100}%`, width: 2,
            background: 'white', opacity: 0.7, pointerEvents: 'none',
            boxShadow: '0 0 6px rgba(0,229,176,0.8)', transform: 'translateX(-1px)',
          }} />
        </div>

        {/* Volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.5 }}>
            <path d="M1 5h3l3-3v10L4 9H1V5z" fill="currentColor"/>
            <path d="M10 3.5c1.5 1 1.5 5.5 0 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            type="range" min={0} max={1} step={0.02} value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            style={{ width: 64, accentColor: 'var(--cyan)', cursor: 'pointer' }}
          />
        </div>

        {/* Panel buttons */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {['eq', 'comp', 'pitch'].map(name => {
            const active = activePanel === name;
            const color  = PANEL_COLORS[name];
            const rgba   = { eq: '245,158,11', comp: '251,163,60', pitch: '167,139,250' }[name];
            return (
              <button
                key={name}
                onClick={() => togglePanel(name)}
                title={{ eq: 'Parametric EQ', comp: 'Compressor', pitch: 'Transpose' }[name]}
                style={{
                  width: 46, height: 32, borderRadius: 7, flexShrink: 0,
                  background: active ? `rgba(${rgba},0.15)` : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
                  color: active ? color : 'rgba(255,255,255,0.4)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                  cursor: 'pointer', transition: 'all 0.18s',
                  boxShadow: active ? `0 0 10px ${color}33` : 'none',
                }}
              >
                {name.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
