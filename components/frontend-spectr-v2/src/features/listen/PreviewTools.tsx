import { useEffect, useState } from 'react';
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

  // Per-module summary (live values from the real DSP state) for the rack cards.
  const moduleView = (id: PreviewTool['id']): ModuleView => {
    switch (id) {
      case 'eq': {
        const band = (lo: number, hi: number) =>
          eqBands.slice(lo, hi).reduce((a, b) => a + b.gainDb, 0) / Math.max(1, hi - lo);
        const setGroup = (lo: number, hi: number) => (pct: number) => {
          const g = Math.round((pct * 24 - 12) * 2) / 2;
          setEqEnabled(true);
          setEqBands((bs) => bs.map((b, i) => (i >= lo && i < hi ? { ...b, gainDb: g } : b)));
        };
        const knobs: KnobSpec[] = [
          { label: 'Low', ...fmtDb(band(0, 3)), set: setGroup(0, 3) },
          { label: 'Mid', ...fmtDb(band(3, 6)), set: setGroup(3, 6) },
          { label: 'Hi', ...fmtDb(band(6, 8)), set: setGroup(6, 8) },
        ];
        return { on: eqEnabled, viz: <EqMiniViz bands={eqBands} acc="#00e5b0" />, knobs, footer: 'Q 1.4', toggle: () => setEqEnabled((v) => !v) };
      }
      case 'comp':
        return {
          on: comp.enabled,
          viz: <CompMiniViz />,
          knobs: [
            { label: 'Thr', value: comp.thresholdDb.toFixed(0), pct: (comp.thresholdDb + 60) / 60, set: (p) => setComp((c) => ({ ...c, thresholdDb: Math.round(p * 60 - 60) })) },
            { label: 'Ratio', value: `${comp.ratio.toFixed(0)}:1`, pct: (comp.ratio - 1) / 19, set: (p) => setComp((c) => ({ ...c, ratio: Math.round((1 + p * 19) * 10) / 10 })) },
            { label: 'Atk', value: comp.attackMs.toFixed(0), pct: comp.attackMs / 250, set: (p) => setComp((c) => ({ ...c, attackMs: Math.round(p * 250) })) },
          ],
          footer: 'Threshold · Ratio',
          toggle: () => setComp((c) => ({ ...c, enabled: !c.enabled })),
        };
      case 'sat':
        return {
          on: sat.enabled,
          viz: <SatMiniViz />,
          knobs: [
            { label: 'Drive', value: sat.drive.toFixed(2), pct: sat.drive, set: (p) => setSat((c) => ({ ...c, drive: Math.round(p * 100) / 100 })) },
            { label: 'Mix', value: sat.mix.toFixed(2), pct: sat.mix, set: (p) => setSat((c) => ({ ...c, mix: Math.round(p * 100) / 100 })) },
          ],
          footer: '2× OS',
          toggle: () => setSat((c) => ({ ...c, enabled: !c.enabled })),
        };
      case 'ms':
        return {
          on: width.enabled,
          viz: <MsMiniViz />,
          knobs: [{ label: 'Width', value: `${width.width.toFixed(2)}×`, pct: width.width / 2, set: (p) => setWidth((c) => ({ ...c, width: Math.round(p * 2 * 100) / 100 })) }],
          footer: `Mono ← ${width.width.toFixed(2)} → Wide`,
          toggle: () => setWidth((c) => ({ ...c, enabled: !c.enabled })),
        };
      case 'lim':
        return {
          on: false,
          disabled: true,
          viz: <LimMiniViz />,
          knobs: [
            { label: 'Ceiling', value: '-1.0', pct: 0.3 },
            { label: 'Release', value: '--', pct: 0 },
          ],
          footer: 'v2.0',
        };
      case 'pitch':
        return {
          on: pitch.enabled,
          viz: <PitchMiniViz semitones={pitch.semitones} />,
          knobs: [
            { label: 'Semi', value: `${pitch.semitones >= 0 ? '+' : ''}${pitch.semitones}`, pct: (pitch.semitones + 12) / 24, set: (p) => onPitchChange({ ...pitch, semitones: Math.round(p * 24 - 12) }) },
            { label: 'Cents', value: `${pitch.cents >= 0 ? '+' : ''}${pitch.cents}`, pct: (pitch.cents + 50) / 100, set: (p) => onPitchChange({ ...pitch, cents: Math.round(p * 100 - 50) }) },
          ],
          footer: pitch.decoding ? 'Decoding…' : 'Decoded ✓',
          toggle: () => onPitchChange({ ...pitch, enabled: !pitch.enabled }),
        };
      case 'loop': {
        const loopOn = loop.enabled && loop.inSec != null && loop.outSec != null;
        return {
          on: loopOn,
          viz: <LoopMiniViz />,
          loopButtons: true,
          footer: `IN ${loop.inSec != null ? formatTime(loop.inSec) : '—'} OUT ${loop.outSec != null ? formatTime(loop.outSec) : '—'}`,
          toggle: () => onLoopChange({ ...loop, enabled: !loop.enabled && loop.inSec != null && loop.outSec != null }),
        };
      }
      case 'scope':
        return { on: false, viz: <ScopeMiniViz />, scopeFader: true, footer: 'Goniometer · Phase' };
      default:
        return { on: false, viz: null, knobs: [], footer: '' };
    }
  };

  return (
    <section className={`card ${s.rail}`}>
      <header className={s.rackHd}>
        <div className={s.rackTitle}>
          <span className={s.led} />
          Insert rack
        </div>
        <span className={s.activeCountChip}>
          {activeCount} on · bypass {bypass ? 'on' : 'off'}
        </span>
        <div className={s.rackSpacer} />
        <span className={s.rackMeta}>Signal: EQ → Comp → Sat → M/S → Lim → Σ</span>
        <button type="button" className={s.rackToggle} data-on={bypass} onClick={() => setBypass((b) => !b)}>
          Bypass
        </button>
        <button type="button" className={s.rackToggle} onClick={handleResetAll}>
          Reset
        </button>
      </header>

      <div className={s.rackGrid}>
        {TOOLS.map((t) => {
          const v = moduleView(t.id);
          const focused = activeTool === t.id;
          const cls = [s.module, v.on && s.on, focused && s.focused, v.disabled && s.disabled]
            .filter(Boolean)
            .join(' ');
          const openTool = () => {
            if (!v.disabled) onActiveToolChange(focused ? null : t.id);
          };
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={v.disabled ? -1 : 0}
              className={cls}
              style={{ ['--acc' as string]: t.accent } as CSSProperties}
              onClick={openTool}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openTool();
                }
              }}
            >
              <div className={s.moduleHd}>
                <span className={s.moduleIcon}>{MODULE_ICON[t.id]}</span>
                <span className={s.moduleName}>{t.label}</span>
                {t.tier === 'v2' ? (
                  <span className={s.moduleSoon}>Soon</span>
                ) : (
                  <span className={s.moduleLed} />
                )}
              </div>
              <div className={s.moduleSub}>{t.sub}</div>
              {v.viz}
              {v.knobs && (
                <div className={s.knobRowMini}>
                  {v.knobs.map((k) => (
                    <MiniKnob key={k.label} spec={k} acc={t.accent} />
                  ))}
                </div>
              )}
              {v.loopButtons && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className={s.rackToggle}
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoopChange({ ...loop, inSec: currentTime });
                    }}
                  >
                    SET IN
                  </button>
                  <button
                    type="button"
                    className={s.rackToggle}
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoopChange({ ...loop, outSec: currentTime });
                    }}
                  >
                    SET OUT
                  </button>
                </div>
              )}
              {v.scopeFader && <ScopeMiniFader graph={graph} />}
              <div className={s.moduleFooter}>
                <span className={s.moduleSub}>{v.footer}</span>
                <span
                  className={s.modulePower}
                  role={v.toggle ? 'button' : undefined}
                  tabIndex={v.toggle ? 0 : -1}
                  onClick={(e) => {
                    e.stopPropagation();
                    v.toggle?.();
                  }}
                  onKeyDown={(e) => {
                    if (v.toggle && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      e.stopPropagation();
                      v.toggle();
                    }
                  }}
                >
                  {v.on ? 'On' : 'OFF'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── EQ ──────────────────────────────────────────────────────────────


function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Insert-rack module cards (design handoff) ────────────────────────────────

interface KnobSpec {
  label: string;
  value: string;
  pct: number;
  /** Apply a new 0..1 position back to the underlying DSP param. Omit = read-only. */
  set?: (pct: number) => void;
}
interface ModuleView {
  on: boolean;
  disabled?: boolean;
  viz: React.ReactNode;
  knobs?: KnobSpec[];
  loopButtons?: boolean;
  scopeFader?: boolean;
  footer: string;
  toggle?: () => void;
}

function fmtDb(g: number): { value: string; pct: number } {
  return { value: `${g > 0 ? '+' : ''}${g.toFixed(1)}`, pct: (g + 12) / 24 };
}

function KnobArc({ pct, acc }: { pct: number; acc: string }) {
  const p = Math.max(0, Math.min(1, pct));
  const cx = 15;
  const cy = 15;
  const r = 11;
  const polar = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const startAng = (-135 * Math.PI) / 180;
  const endAng = ((-135 + 270 * p) * Math.PI) / 180;
  const fullEndAng = (135 * Math.PI) / 180;
  const [sx, sy] = polar(startAng);
  const [ex, ey] = polar(endAng);
  const [fx, fy] = polar(fullEndAng);
  const largeFg = 270 * p > 180 ? 1 : 0;
  const tx1 = cx + 6 * Math.cos(endAng);
  const ty1 = cy + 6 * Math.sin(endAng);
  const tx2 = cx + 10 * Math.cos(endAng);
  const ty2 = cy + 10 * Math.sin(endAng);
  return (
    <svg viewBox="0 0 30 30">
      <path
        d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${fx.toFixed(2)} ${fy.toFixed(2)}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {p > 0 && (
        <path
          d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeFg} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`}
          fill="none"
          stroke={acc}
          strokeWidth="2"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${acc}80)` }}
        />
      )}
      <circle cx={cx} cy={cy} r="5.5" fill="#0a1020" stroke="rgba(255,255,255,0.14)" strokeWidth="0.6" />
      <line
        x1={tx1.toFixed(2)}
        y1={ty1.toFixed(2)}
        x2={tx2.toFixed(2)}
        y2={ty2.toFixed(2)}
        stroke={acc}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniKnob({ spec, acc }: { spec: KnobSpec; acc: string }) {
  const draggable = Boolean(spec.set);

  // Vertical drag: up = increase. Full 0..1 sweep over ~150px. Tracked on window
  // so the drag survives the pointer leaving the small knob hit-area.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!spec.set) return;
    e.stopPropagation();
    e.preventDefault();
    const set = spec.set;
    const startY = e.clientY;
    const startPct = spec.pct;
    const move = (ev: PointerEvent) => {
      const next = Math.max(0, Math.min(1, startPct + (startY - ev.clientY) / 150));
      set(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!spec.set) return;
    const step = e.shiftKey ? 0.1 : 1 / 50;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      spec.set(Math.min(1, spec.pct + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      spec.set(Math.max(0, spec.pct - step));
    }
  };

  return (
    <div className={s.miniKnob}>
      <span className={s.miniKnobValue}>{spec.value}</span>
      <div
        className={`${s.knobVisual}${draggable ? ` ${s.knobDraggable}` : ''}`}
        onPointerDown={onPointerDown}
        onClick={draggable ? (e) => e.stopPropagation() : undefined}
        onKeyDown={onKeyDown}
        role={draggable ? 'slider' : undefined}
        tabIndex={draggable ? 0 : undefined}
        aria-label={draggable ? spec.label : undefined}
        aria-valuemin={draggable ? 0 : undefined}
        aria-valuemax={draggable ? 100 : undefined}
        aria-valuenow={draggable ? Math.round(spec.pct * 100) : undefined}
      >
        <KnobArc pct={spec.pct} acc={acc} />
      </div>
      <span className={s.miniKnobLabel}>{spec.label}</span>
    </div>
  );
}

// Module header icons (inline SVG, accent-tinted by the card).
const MODULE_ICON: Record<PreviewTool['id'], React.ReactNode> = {
  eq: (
    <svg width="14" height="14" viewBox="0 0 24 16" fill="none">
      <path d="M1 8 C3 8 4 5 7 4.5 C10 4 12 4 14 6 C16 8 18 5 21 5.5 C22 5.7 23 7 23 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="4.5" r="1.1" fill="currentColor" />
      <circle cx="14" cy="6" r="1.1" fill="currentColor" />
      <circle cx="21" cy="5.5" r="1.1" fill="currentColor" />
    </svg>
  ),
  comp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" opacity="0.3" strokeWidth="1.2" strokeDasharray="2 2" />
      <path d="M3 21 L11 13 L21 9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  ),
  sat: (
    <svg width="14" height="14" viewBox="0 0 24 12" fill="none">
      <path d="M1 6 C3 1, 5 1, 6 6 C7 11, 11 11, 12 6 C13 1, 17 1, 18 6 C19 11, 21 11, 23 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  ),
  ms: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 12 L8 8 M4 12 L8 16 M4 12 L12 12 M20 12 L16 8 M20 12 L16 16 M20 12 L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  lim: (
    <svg width="14" height="14" viewBox="0 0 24 16" fill="none">
      <line x1="1" y1="3" x2="23" y2="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M1 14 L3 8 L5 3 L7 11 L9 5 L11 3 L13 9 L15 4 L17 3 L19 7 L21 3 L23 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  pitch: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M6 2 V14 M10 2 V14 M3 5.5 H13 M3 10.5 H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  loop: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M5 12 A7 7 0 1 1 12 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M12 19 L9 16 M12 19 L9 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="3" y1="4" x2="3" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="21" y1="4" x2="21" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  scope: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 4 L20 20 M4 20 L20 4" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
    </svg>
  ),
};

function EqMiniViz({ bands, acc }: { bands: EqBand[]; acc: string }) {
  const n = bands.length;
  const yFor = (g: number) => 15 - Math.max(-1, Math.min(1, g / 12)) * 10;
  const pts = bands.map((b, i) => [(i / (n - 1)) * 100, yFor(b.gainDb)] as const);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(0)},${p[1].toFixed(1)}`).join(' ');
  const fill = `${line} L100,30 L0,30 Z`;
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" strokeDasharray="2 2" />
      <path d={fill} fill={acc} opacity="0.16" />
      <path d={line} fill="none" stroke={acc} strokeWidth="1.4" />
    </svg>
  );
}
function CompMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      <line x1="50" x2="50" y1="0" y2="30" stroke="rgba(251,191,36,0.4)" strokeWidth="0.8" strokeDasharray="1 2" />
      <path d="M0,28 L50,15 L100,9" fill="none" stroke="#fbbf24" strokeWidth="1.4" />
      <path d="M0,28 L100,1" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="2 2" />
    </svg>
  );
}
function SatMiniViz() {
  const bars = [
    [6, 6, 22, 0.85], [20, 14, 14, 0.7], [34, 10, 18, 0.8], [48, 20, 8, 0.55],
    [62, 17, 11, 0.6], [76, 22, 6, 0.45], [90, 24, 4, 0.35],
  ];
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="28" y2="28" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      {bars.map(([x, y, h, o], i) => (
        <rect key={i} x={x} y={y} width="6" height={h} fill="#fb923c" opacity={o} />
      ))}
    </svg>
  );
}
function MsMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="50" x2="50" y1="2" y2="28" stroke="rgba(96,165,250,0.4)" strokeWidth="0.8" strokeDasharray="1 2" />
      <ellipse cx="50" cy="15" rx="36" ry="11" fill="rgba(96,165,250,0.12)" stroke="#60a5fa" strokeWidth="1.2" />
      <circle cx="20" cy="15" r="1.5" fill="#60a5fa" />
      <circle cx="80" cy="15" r="1.5" fill="#60a5fa" />
    </svg>
  );
}
function LimMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="6" y2="6" stroke="#f43f5e" strokeWidth="1.2" />
      <path d="M0,26 L8,14 L16,6 L24,18 L32,8 L40,6 L48,15 L56,6 L64,11 L72,6 L80,17 L88,6 L100,22" fill="none" stroke="rgba(244,63,94,0.5)" strokeWidth="1.2" />
    </svg>
  );
}
function PitchMiniViz({ semitones }: { semitones: number }) {
  const x = 50 + Math.max(-12, Math.min(12, semitones)) * (44 / 12);
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <rect x="0" y="6" width="100" height="18" fill="rgba(255,255,255,0.04)" />
      <g fill="rgba(167,139,250,0.6)">
        <rect x="8" y="6" width="6" height="11" />
        <rect x="20" y="6" width="6" height="11" />
        <rect x="40" y="6" width="6" height="11" />
        <rect x="52" y="6" width="6" height="11" />
        <rect x="64" y="6" width="6" height="11" />
        <rect x="84" y="6" width="6" height="11" />
      </g>
      <line x1={x} x2={x} y1="2" y2="28" stroke="#00f3bd" strokeWidth="1.2" />
    </svg>
  );
}
function LoopMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <rect x="38" y="6" width="24" height="18" fill="rgba(167,139,250,0.18)" stroke="#a78bfa" strokeWidth="1" />
      <text x="50" y="20" fontFamily="JetBrains Mono" fontSize="6.5" fill="#a78bfa" textAnchor="middle" fontWeight="700">
        A → B
      </text>
    </svg>
  );
}
function ScopeMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="xMidYMid meet">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
      <line x1="50" x2="50" y1="0" y2="30" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
      <ellipse cx="50" cy="15" rx="6" ry="10" fill="none" stroke="#34d399" strokeWidth="1.1" opacity="0.7" />
      <ellipse cx="50" cy="15" rx="3" ry="13" fill="none" stroke="#34d399" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
function ScopeMiniFader({ graph }: { graph: AudioGraphHandle }) {
  const [corr, setCorr] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = graph.readFrame().correlation;
      // Skip the state update when the value is effectively unchanged (paused or
      // steady) so React bails the re-render instead of churning at 60fps forever.
      setCorr((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph]);
  const pct = ((corr + 1) / 2) * 100;
  return (
    <div className={s.miniKnob} style={{ flex: 2 }}>
      <span className={s.miniKnobValue}>{corr.toFixed(2)}</span>
      <div className={s.miniFader}>
        <div className={s.miniFaderFill} style={{ width: `${pct}%`, background: '#34d399' }} />
        <div className={s.miniFaderThumb} style={{ left: `${pct}%`, background: '#34d399' }} />
      </div>
      <span className={s.miniKnobLabel}>Correlation L/R</span>
    </div>
  );
}
