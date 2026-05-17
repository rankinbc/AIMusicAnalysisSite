import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type {
  AudioGraphHandle,
  CompressorState,
  EqBand,
  SaturationState,
  WidthState,
} from './useAudioGraph';
import {
  COMPRESSOR_DEFAULT,
  EQ_BANDS_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
} from './useAudioGraph';
import { LOOP_DEFAULT, type LoopState, type PitchPanelState } from './loop';
import { PitchPanel } from './PitchPanel';
import s from './PreviewTools.module.css';

interface PreviewToolsProps {
  graph: AudioGraphHandle;
  activeTool: string | null;
  onActiveToolChange: (id: string | null) => void;
  loop: LoopState;
  onLoopChange: (next: LoopState) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  pitch: PitchPanelState;
  onPitchChange: (next: PitchPanelState) => void;
}

interface PreviewTool {
  id: 'eq' | 'comp' | 'sat' | 'ms' | 'lim' | 'pitch' | 'loop' | 'scope';
  label: string;
  glyph: string;
  sub: string;
  tier: 'v1' | 'v2';
  accent: string;
}

const TOOLS: PreviewTool[] = [
  { id: 'eq', label: 'EQ', glyph: 'EQ', sub: '8-band parametric', tier: 'v1', accent: '#00e5b0' },
  { id: 'comp', label: 'Compressor', glyph: '◐', sub: 'Threshold · ratio', tier: 'v1', accent: '#fbbf24' },
  { id: 'sat', label: 'Saturation', glyph: '~', sub: 'Tanh drive', tier: 'v1', accent: '#fb923c' },
  { id: 'ms', label: 'M/S Width', glyph: '◭', sub: 'Mid / side balance', tier: 'v1', accent: '#60a5fa' },
  { id: 'lim', label: 'Limiter', glyph: '|', sub: 'Brickwall', tier: 'v2', accent: '#f43f5e' },
  { id: 'pitch', label: 'Pitch', glyph: '#', sub: 'Cents · semitones', tier: 'v1', accent: '#a78bfa' },
  { id: 'loop', label: 'Loop', glyph: '⟲', sub: 'Section loop', tier: 'v1', accent: '#a78bfa' },
  { id: 'scope', label: 'Scope', glyph: '◎', sub: 'Goniometer · phase', tier: 'v1', accent: '#34d399' },
];

export function PreviewTools({
  graph,
  activeTool,
  onActiveToolChange,
  loop,
  onLoopChange,
  audioRef,
  currentTime,
  duration,
  pitch,
  onPitchChange,
}: PreviewToolsProps) {
  const [eqBands, setEqBands] = useState<EqBand[]>(() =>
    EQ_BANDS_DEFAULT.map((b) => ({ ...b })),
  );
  const [eqEnabled, setEqEnabled] = useState(false);
  const [comp, setComp] = useState<CompressorState>({ ...COMPRESSOR_DEFAULT });
  const [sat, setSat] = useState<SaturationState>({ ...SATURATION_DEFAULT });
  const [width, setWidth] = useState<WidthState>({ ...WIDTH_DEFAULT });
  const [bypass, setBypass] = useState(false);

  // Mirror state into the audio graph whenever it changes.
  useEffect(() => {
    eqBands.forEach((b, i) => graph.setEqBand(i, eqEnabled ? b.gainDb : 0));
  }, [eqBands, eqEnabled, graph]);

  useEffect(() => {
    graph.setCompressor(comp);
  }, [comp, graph]);

  useEffect(() => {
    graph.setSaturation(sat);
  }, [sat, graph]);

  useEffect(() => {
    graph.setWidth(width);
  }, [width, graph]);

  useEffect(() => {
    graph.setMasterBypass(bypass);
  }, [bypass, graph]);

  // Loop control — checks each animation frame whether currentTime crossed
  // the loopEnd, and seeks back to loopStart.
  useEffect(() => {
    if (!loop.enabled || loop.inSec == null || loop.outSec == null) return;
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (loop.outSec != null && loop.inSec != null && a.currentTime >= loop.outSec) {
        a.currentTime = loop.inSec;
      }
    };
    a.addEventListener('timeupdate', onTime);
    return () => a.removeEventListener('timeupdate', onTime);
  }, [loop, audioRef]);

  const activeCount =
    Number(eqEnabled) +
    Number(comp.enabled) +
    Number(sat.enabled) +
    Number(width.enabled) +
    Number(loop.enabled) +
    Number(pitch.enabled);

  const handleResetAll = () => {
    setEqBands(EQ_BANDS_DEFAULT.map((b) => ({ ...b })));
    setEqEnabled(false);
    setComp({ ...COMPRESSOR_DEFAULT });
    setSat({ ...SATURATION_DEFAULT });
    setWidth({ ...WIDTH_DEFAULT });
    onLoopChange(LOOP_DEFAULT);
    onPitchChange({ ...pitch, semitones: 0, cents: 0, enabled: false });
    setBypass(false);
    graph.resetAll();
  };

  const tool = TOOLS.find((t) => t.id === activeTool);

  return (
    <section className={`card ${s.rail}`}>
      <header className={s.hd}>
        <div className={s.title}>
          <span className="dot" />
          Preview adjustments
          {activeCount > 0 && <span className={s.activeCount}>· {activeCount} ON</span>}
        </div>
        <div className={s.hdActions}>
          <button
            type="button"
            className={s.bypassToggle}
            data-on={bypass}
            onClick={() => setBypass((b) => !b)}
            title="Bypass entire chain"
          >
            BYPASS {bypass ? 'ON' : 'OFF'}
          </button>
          <button type="button" className={s.bypassToggle} onClick={handleResetAll}>
            RESET
          </button>
        </div>
      </header>

      <div className={s.grid}>
        {TOOLS.map((t) => {
          const isOn =
            (t.id === 'eq' && eqEnabled) ||
            (t.id === 'comp' && comp.enabled) ||
            (t.id === 'sat' && sat.enabled) ||
            (t.id === 'ms' && width.enabled) ||
            (t.id === 'loop' && loop.enabled) ||
            (t.id === 'pitch' && pitch.enabled);
          return (
            <button
              key={t.id}
              type="button"
              className={s.tile}
              data-active={activeTool === t.id}
              data-tier={t.tier}
              data-on={isOn}
              style={
                {
                  ['--tile-color' as string]: t.accent,
                  ['--tile-bg' as string]: `${t.accent}14`,
                  ['--tile-border' as string]: `${t.accent}50`,
                } as CSSProperties
              }
              onClick={() => onActiveToolChange(activeTool === t.id ? null : t.id)}
              disabled={t.tier === 'v2'}
            >
              <div className={s.tileTop}>
                <span className={s.glyph}>{t.glyph}</span>
                <span className={s.label}>{t.label}</span>
                {t.tier === 'v2' && <span className={s.tierBadge}>SOON</span>}
                {isOn && <span className={s.onDot} />}
              </div>
              <div className={s.sub}>{t.sub}</div>
            </button>
          );
        })}
      </div>

      {tool && (
        <div
          className={s.panel}
          style={{ ['--panel-accent' as string]: tool.accent } as CSSProperties}
        >
          <div className={s.panelHd}>
            <span className={s.panelTitle}>{tool.label}</span>
            <button type="button" className={s.smallBtn} onClick={() => onActiveToolChange(null)}>
              close
            </button>
          </div>
          {tool.id === 'eq' && (
            <EqControls
              bands={eqBands}
              enabled={eqEnabled}
              onBandsChange={setEqBands}
              onEnabledChange={setEqEnabled}
            />
          )}
          {tool.id === 'comp' && <CompressorControls state={comp} onChange={setComp} />}
          {tool.id === 'sat' && <SatControls state={sat} onChange={setSat} />}
          {tool.id === 'ms' && <WidthControls state={width} onChange={setWidth} />}
          {tool.id === 'loop' && (
            <LoopControls
              state={loop}
              onChange={onLoopChange}
              currentTime={currentTime}
              duration={duration}
            />
          )}
          {tool.id === 'scope' && <ScopeControls graph={graph} />}
          {tool.id === 'pitch' && (
            <PitchPanel
              semitones={pitch.semitones}
              cents={pitch.cents}
              enabled={pitch.enabled}
              decoding={pitch.decoding}
              decodeError={pitch.decodeError}
              onSemitonesChange={(st) => onPitchChange({ ...pitch, semitones: st })}
              onCentsChange={(c) => onPitchChange({ ...pitch, cents: c })}
              onEnabledChange={(v) => onPitchChange({ ...pitch, enabled: v })}
            />
          )}
          {tool.id === 'lim' && <p className={s.panelEmpty}>Shipping in v2.</p>}
        </div>
      )}
    </section>
  );
}

// ── EQ ──────────────────────────────────────────────────────────────

function EqControls({
  bands,
  enabled,
  onBandsChange,
  onEnabledChange,
}: {
  bands: EqBand[];
  enabled: boolean;
  onBandsChange: (b: EqBand[]) => void;
  onEnabledChange: (v: boolean) => void;
}) {
  const setBandGain = (i: number, gainDb: number) => {
    onBandsChange(bands.map((b, idx) => (idx === i ? { ...b, gainDb } : b)));
  };
  return (
    <>
      <ToolToggle
        label="EQ enabled"
        on={enabled}
        onChange={onEnabledChange}
        hint="Boost / cut 8 fixed-frequency bands. Centered Q ≈ 1.4."
      />
      <EqCurve bands={bands} />
      <div className={s.eqBandsRow}>
        {bands.map((b, i) => (
          <div key={b.freq} className={s.eqBand}>
            <span className={s.eqBandGain}>
              {b.gainDb > 0 ? '+' : ''}
              {b.gainDb.toFixed(1)}
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={b.gainDb}
              onChange={(e) => setBandGain(i, parseFloat(e.target.value))}
              className={s.eqSlider}
              aria-label={`${b.freq} Hz band gain`}
            />
            <span className={s.eqBandLabel}>{formatHz(b.freq)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function EqCurve({ bands }: { bands: EqBand[] }) {
  // Crude visual: cubic-spline-ish bezier between control points, colored cyan.
  const W = 600;
  const H = 110;
  const padX = 8;
  const padY = 8;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const yFor = (db: number) => padY + innerH / 2 - (db / 12) * (innerH / 2);
  const xs = bands.map((_, i) => padX + (i / (bands.length - 1)) * innerW);
  const ys = bands.map((b) => yFor(b.gainDb));
  const path = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${ys[i].toFixed(1)}`)
    .join(' ');
  const fillPath = `${path} L ${xs[xs.length - 1]},${padY + innerH} L ${xs[0]},${padY + innerH} Z`;
  return (
    <div className={s.eqWrap}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line
          x1={padX}
          x2={W - padX}
          y1={H / 2}
          y2={H / 2}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <path d={fillPath} fill="var(--cyan)" opacity="0.12" />
        <path
          d={path}
          stroke="var(--cyan)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {xs.map((x, i) => (
          <circle
            key={i}
            cx={x}
            cy={ys[i]}
            r={4}
            fill="var(--cyan)"
            stroke="#06151a"
            strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }}
          />
        ))}
      </svg>
    </div>
  );
}

// ── Compressor ──────────────────────────────────────────────────────

function CompressorControls({
  state,
  onChange,
}: {
  state: CompressorState;
  onChange: (next: CompressorState) => void;
}) {
  const set = <K extends keyof CompressorState>(k: K, v: CompressorState[K]) =>
    onChange({ ...state, [k]: v });
  return (
    <>
      <ToolToggle
        label="Compressor enabled"
        on={state.enabled}
        onChange={(v) => set('enabled', v)}
        hint="DynamicsCompressorNode — threshold + ratio + attack + release."
      />
      <div className={s.knobRow}>
        <Knob
          label="Threshold"
          unit="dB"
          value={state.thresholdDb}
          min={-60}
          max={0}
          step={0.5}
          onChange={(v) => set('thresholdDb', v)}
        />
        <Knob
          label="Ratio"
          unit=":1"
          value={state.ratio}
          min={1}
          max={20}
          step={0.1}
          onChange={(v) => set('ratio', v)}
        />
        <Knob
          label="Attack"
          unit="ms"
          value={state.attackMs}
          min={0}
          max={250}
          step={1}
          onChange={(v) => set('attackMs', v)}
        />
        <Knob
          label="Release"
          unit="ms"
          value={state.releaseMs}
          min={10}
          max={1000}
          step={10}
          onChange={(v) => set('releaseMs', v)}
        />
        <Knob
          label="Knee"
          unit="dB"
          value={state.kneeDb}
          min={0}
          max={40}
          step={1}
          onChange={(v) => set('kneeDb', v)}
        />
        <Knob
          label="Makeup"
          unit="dB"
          value={state.makeupDb}
          min={0}
          max={24}
          step={0.5}
          onChange={(v) => set('makeupDb', v)}
        />
      </div>
    </>
  );
}

// ── Saturation ──────────────────────────────────────────────────────

function SatControls({
  state,
  onChange,
}: {
  state: SaturationState;
  onChange: (next: SaturationState) => void;
}) {
  return (
    <>
      <ToolToggle
        label="Saturation enabled"
        on={state.enabled}
        onChange={(v) => onChange({ ...state, enabled: v })}
        hint="WaveShaper with a tanh curve. 2× oversampled."
      />
      <div className={s.knobRow}>
        <Knob
          label="Drive"
          unit=""
          value={state.drive}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ ...state, drive: v })}
        />
        <Knob
          label="Mix"
          unit=""
          value={state.mix}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ ...state, mix: v })}
        />
      </div>
    </>
  );
}

// ── M/S Width ───────────────────────────────────────────────────────

function WidthControls({
  state,
  onChange,
}: {
  state: WidthState;
  onChange: (next: WidthState) => void;
}) {
  return (
    <>
      <ToolToggle
        label="M/S Width enabled"
        on={state.enabled}
        onChange={(v) => onChange({ ...state, enabled: v })}
        hint="0 = mono · 1 = identity · 2 = exaggerated sides"
      />
      <div className={s.knobRow}>
        <Knob
          label="Width"
          unit="×"
          value={state.width}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => onChange({ ...state, width: v })}
        />
      </div>
    </>
  );
}

// ── Loop ────────────────────────────────────────────────────────────

function LoopControls({
  state,
  onChange,
  currentTime,
  duration,
}: {
  state: LoopState;
  onChange: (next: LoopState) => void;
  currentTime: number;
  duration: number;
}) {
  const setIn = () => onChange({ ...state, inSec: currentTime });
  const setOut = () => onChange({ ...state, outSec: currentTime });
  const clear = () => onChange({ ...LOOP_DEFAULT });
  return (
    <>
      <ToolToggle
        label="Loop enabled"
        on={state.enabled && state.inSec != null && state.outSec != null}
        onChange={(v) =>
          onChange({ ...state, enabled: v && state.inSec != null && state.outSec != null })
        }
        hint="Lock playback to a section. Set in/out points at current time."
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.smallBtn} onClick={setIn}>
          Set IN @ {formatTime(currentTime)}
        </button>
        <button type="button" className={s.smallBtn} onClick={setOut}>
          Set OUT @ {formatTime(currentTime)}
        </button>
        <button type="button" className={s.smallBtn} onClick={clear}>
          Clear
        </button>
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
        IN: {state.inSec != null ? formatTime(state.inSec) : '—'} · OUT:{' '}
        {state.outSec != null ? formatTime(state.outSec) : '—'} · Length:{' '}
        {state.inSec != null && state.outSec != null
          ? formatTime(state.outSec - state.inSec)
          : '—'}{' '}
        / {formatTime(duration)}
      </div>
    </>
  );
}

// ── Scope (goniometer + correlation) ────────────────────────────────

function ScopeControls({ graph }: { graph: AudioGraphHandle }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [correlation, setCorrelation] = useState(0);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const frame = graph.readFrame();
      setCorrelation(frame.correlation);

      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = 'rgba(7, 10, 18, 0.4)';
      ctx.fillRect(0, 0, w, h);

      // Reference cross lines (mid/side axes — rotated 45°)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.moveTo(w, 0);
      ctx.lineTo(0, h);
      ctx.stroke();

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(cx, cy) * 0.85;

      // Plot L+R as Lissajous: rotated 45° so mono = vertical line.
      ctx.fillStyle = 'rgba(0, 229, 176, 0.8)';
      const L = frame.scopeL;
      const R = frame.scopeR;
      for (let i = 0; i < L.length; i += 8) {
        // Convert (L,R) → mid/side after a 45° rotation:
        //   x = (L - R) * sin45 = side
        //   y = -(L + R) * cos45 = -mid (negative because canvas Y grows downward)
        const x = (L[i] - R[i]) * 0.7071 * radius;
        const y = -(L[i] + R[i]) * 0.7071 * radius;
        ctx.fillRect(cx + x - 0.5, cy + y - 0.5, 1.5, 1.5);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graph]);

  const corrPct = ((correlation + 1) / 2) * 100;
  const corrColor =
    correlation < 0 ? 'var(--red)' : correlation < 0.3 ? 'var(--yellow)' : 'var(--cyan)';

  return (
    <div className={s.scope}>
      <canvas ref={canvasRef} width={130} height={130} className={s.scopeCanvas} />
      <div className={s.corrColumn}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            color: 'var(--muted)',
          }}
        >
          <span>L/R correlation</span>
          <span style={{ color: corrColor, fontWeight: 700 }}>{correlation.toFixed(2)}</span>
        </div>
        <div className={s.corrBar}>
          <div
            className={s.corrDot}
            style={{ left: `${corrPct}%`, background: corrColor, boxShadow: `0 0 6px ${corrColor}` }}
          />
        </div>
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            color: 'var(--muted)',
            lineHeight: 1.5,
          }}
        >
          ⟵ Out of phase · Mono · In phase ⟶
        </div>
      </div>
    </div>
  );
}

// ── Shared primitives ───────────────────────────────────────────────

function Knob({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={s.knob}>
      <span className={s.knobLabel}>{label}</span>
      <span className={s.knobValue}>
        {value.toFixed(step < 1 ? 2 : 0)}
        {unit && <span style={{ color: 'var(--muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={s.knobInput}
        aria-label={label}
      />
    </div>
  );
}

function ToolToggle({
  label,
  on,
  onChange,
  hint,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
        {hint && (
          <div className={s.panelSub} style={{ marginTop: 2, fontSize: 11 }}>
            {hint}
          </div>
        )}
      </div>
      <button
        type="button"
        className={s.bypassToggle}
        data-on={on}
        onClick={() => onChange(!on)}
        style={on ? { color: 'var(--cyan)', borderColor: 'rgba(0,229,176,0.4)', background: 'rgba(0,229,176,0.06)' } : undefined}
      >
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`;
  return String(hz);
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
