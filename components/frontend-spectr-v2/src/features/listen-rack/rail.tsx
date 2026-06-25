/* SPECTR · Listen rack redesign — right panel (tabs) + collapsible visual meters
 * Tabs: Coach · Plan · People · Chat · Stats · Notes.
 *
 * SWAP BOUNDARY (see PORTING_NOTES.md):
 *   useLiveMeters → real loudness/stereo selectors (AnalyserNode follower).
 *   coachReply    → real coach analysis feed (each item keeps an `apply` patch).
 *   People/Chat   → real-time presence + messages + grant-control.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import {
  MOCK_COMMENTS, railTabsFor, type AccessDto, type ActorRef, type CommentDto, type ModeId,
} from './access';
import {
  BG_COLORS, DIRECTORS, LASER_EFFECTS, LASER_PATTERNS, PLAN_ITEMS, REACTION_GROUPS,
  ROOM_LISTENERS, STAGES, type RackPatch, type ReactionFeedItem, type Track, type TrackNote, type VizState,
} from './data';
import { Coach } from '../../ui/Coach';
import type { AudioFrame } from '../listen/useAudioGraph';
import { cssVar, fmtTime, hslToHex } from './helpers';
import type { CapabilitySet } from './capabilities';
import { sameActor, type RoomControl } from './identity';
import type { RackState } from './rackState';
import { Avatar, HSlider, HueSlider, SelectChip, Switch } from './ui';

// SYNC toggle shown in a console bay header — binds that module to the music
function SyncTag({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Sync to the music">
      <span className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: on ? 'var(--cyan)' : 'var(--muted)' }}>SYNC</span>
      <Switch on={on} onChange={onChange} />
    </label>
  );
}

function hexHue(hex: string): number {
  if (!hex || hex[0] !== '#') return 165;
  const m = hex.slice(1);
  const r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, b = parseInt(m.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return Math.round(h);
}

interface LiveMeters { lufsS: number; peak: number; corr: number; rms: number }
function useLiveMeters(track: Track, playing: boolean): LiveMeters {
  const base: LiveMeters = { lufsS: track.loudness.integrated, peak: track.loudness.truePeak, corr: track.stereo.correlation, rms: track.loudness.rms };
  const [v, setV] = useState<LiveMeters>(base);
  useEffect(() => {
    if (!playing) { setV({ lufsS: track.loudness.integrated, peak: track.loudness.truePeak, corr: track.stereo.correlation, rms: track.loudness.rms }); return undefined; }
    let raf = 0;
    const t0 = performance.now() / 1000;
    const tick = () => {
      const t = performance.now() / 1000 - t0;
      setV({
        lufsS: track.loudness.integrated + Math.sin(t * 1.7) * 1.1 + Math.sin(t * 4.3) * 0.5,
        peak: track.loudness.truePeak + Math.sin(t * 2.2) * 0.35 + Math.max(0, Math.sin(t * 7.5)) * 0.4,
        corr: track.stereo.correlation + Math.sin(t * 0.8) * 0.07,
        rms: track.loudness.rms + Math.sin(t * 1.3) * 0.8,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, track]);
  return v;
}

// ── collapsible visual meters (the on-stage "Metering" overlay) ────────────
function MiniBar({ label, value, fmt, min, max, target, danger, accent = 'var(--cyan)' }: {
  label: string; value: number; fmt: string; min: number; max: number; target?: number; danger?: number; accent?: string;
}) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const tp = target != null ? (target - min) / (max - min) : null;
  const hot = danger != null && value >= danger;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--muted)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: hot ? 'var(--orange)' : accent }}>{fmt}</span>
      </div>
      <div style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${t * 100}%`, background: hot ? 'var(--orange)' : accent, borderRadius: 3 }} />
        {tp != null && <div style={{ position: 'absolute', left: `${tp * 100}%`, top: -1, bottom: -1, width: 1.5, background: 'rgba(255,255,255,0.7)' }} />}
      </div>
    </div>
  );
}

export function VisualMeters({ track, playing, open, setOpen, frame }: {
  track: Track; playing: boolean; open: boolean; setOpen: (v: boolean) => void; frame?: AudioFrame | null;
}) {
  const synthetic = useLiveMeters(track, playing);
  // Real AnalyserNode frame (Phase 2) when supplied; synthetic fallback on the
  // mock demo route. Frame levels can be -Infinity in silence — guard display.
  const lm: LiveMeters = frame
    ? { lufsS: frame.lufsShort, peak: frame.truePeakDb, corr: frame.correlation, rms: frame.rmsDb }
    : synthetic;
  const txt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');
  const corr = Number.isFinite(lm.corr) ? lm.corr : 0;
  const corrPct = (corr + 1) / 2;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mono" style={{ position: 'absolute', top: 12, right: 12, zIndex: 7, fontSize: 9.5, padding: '6px 10px', borderRadius: 8, background: 'rgba(7,10,18,0.72)', border: '1px solid var(--border)', backdropFilter: 'blur(10px)', color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: playing ? 'var(--cyan)' : 'var(--muted)', boxShadow: playing ? '0 0 6px var(--cyan)' : 'none' }} />
        <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>{txt(lm.lufsS)}</span> LUFS-S ▸
      </button>
    );
  }
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 7, width: 168, padding: '10px 12px', borderRadius: 10, background: 'rgba(7,10,18,0.74)', border: '1px solid var(--border)', backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--cyan)', fontWeight: 700 }}>METERING</span>
        <button type="button" onClick={() => setOpen(false)} className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>▾</button>
      </div>
      <MiniBar label="LUFS-S" value={lm.lufsS} fmt={txt(lm.lufsS)} min={-36} max={0} target={-14} />
      <MiniBar label="TRUE PEAK" value={lm.peak} fmt={txt(lm.peak)} min={-18} max={0} danger={-1} accent="var(--cyan)" />
      <MiniBar label="RMS" value={lm.rms} fmt={txt(lm.rms)} min={-36} max={0} accent="var(--violet)" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--muted)' }}>CORR</span>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: corr < 0 ? 'var(--red)' : 'var(--cyan)' }}>{corr >= 0 ? '+' : ''}{corr.toFixed(2)}</span>
        </div>
        <div style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3 }}>
          <div style={{ position: 'absolute', left: '50%', top: -1, bottom: -1, width: 1, background: 'rgba(255,255,255,0.25)' }} />
          <div style={{ position: 'absolute', top: '50%', left: `${corrPct * 100}%`, width: 8, height: 8, borderRadius: '50%', transform: 'translate(-50%,-50%)', background: corr < 0 ? 'var(--red)' : 'var(--cyan)', boxShadow: `0 0 6px ${corr < 0 ? 'var(--red)' : 'var(--cyan)'}` }} />
        </div>
      </div>
    </div>
  );
}

function PLabel({ children, accent = 'var(--muted)' }: { children: React.ReactNode; accent?: string }) {
  return <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: accent, textTransform: 'uppercase', fontWeight: 700, margin: '2px 0' }}>{children}</div>;
}

// ── VISUALS console — all visualization options (host drives for everyone) ──
export function VisualsPanel({ stages, toggleStage, director, setDirector, viz, setViz, presets = [], onSave, onRecall, onRandomize }: {
  stages: string[];
  toggleStage: (id: string) => void;
  director: string;
  setDirector: (id: string) => void;
  viz: VizState;
  setViz: Dispatch<SetStateAction<VizState>>;
  presets?: { id: string; name: string }[];
  onSave?: () => void;
  onRecall?: (p: { id: string; name: string }) => void;
  onRandomize?: () => void;
}) {
  const dirObj = DIRECTORS.find((d) => d.id === director);
  const PALETTE = BG_COLORS;
  const accentNow = viz.barColor.startsWith('var') ? '#00e5b0' : viz.barColor;
  const theme = viz.theme || ['#00e5b0', '#a78bfa', '#fb923c'];
  const syncAllOn = viz.autoColor && viz.laserSync && viz.bgSync && viz.dropFx && viz.autoReact;
  const toggleSyncAll = () => setViz((s) => { const on = !(s.autoColor && s.laserSync && s.bgSync && s.dropFx && s.autoReact); return { ...s, autoColor: on, laserSync: on, bgSync: on, dropFx: on, autoReact: on }; });
  const cycleTheme = (i: number) => setViz((s) => { const t = [...(s.theme || theme)]; const idx = BG_COLORS.indexOf(t[i]); t[i] = BG_COLORS[(idx + 1) % BG_COLORS.length]; return { ...s, theme: t }; });
  const applyTheme = () => setViz((s) => { const t = s.theme || theme; return { ...s, barColor: t[0], specHue: hexHue(t[0]), laserColor: t[1], laserHue: hexHue(t[1]), laserMono: true, bg: t[2], bgHue: hexHue(t[2]), bgAuto: false }; });
  return (
    <div className="card lr-rack-panel" style={{ overflow: 'visible' }}>
      <div className="card-hd">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="dot" style={{ background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }} />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase' }}>VISUALS CONSOLE</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{stages.length} stage{stages.length === 1 ? '' : 's'} · {dirObj ? dirObj.label.toLowerCase() : 'manual'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onRecall && (
            <select onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) onRecall(p); }} className="mono" style={{ fontSize: 9, background: 'var(--card-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px' }}>
              <option value="">Presets ({presets.length})</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {onRandomize && <button type="button" onClick={onRandomize} className="btn sm" style={{ fontSize: 9.5, padding: '5px 10px' }}>⊞ Random</button>}
          {onSave && <button type="button" onClick={onSave} className="btn sm primary" style={{ fontSize: 9.5, padding: '5px 10px' }}>+ Save</button>}
        </div>
      </div>

      <div className="card-body lr-lc-grid">
        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className="lr-lc-led" style={{ background: 'var(--cyan)', boxShadow: '0 0 7px var(--cyan)' }} /><span className="lr-lc-label">Primary actions</span></div>
          <button type="button" onClick={toggleSyncAll} className="btn sm" style={{ width: '100%', justifyContent: 'center', color: syncAllOn ? 'var(--green)' : 'var(--cyan)', borderColor: syncAllOn ? 'rgba(52,211,153,0.4)' : 'rgba(0,229,176,0.4)', marginBottom: 9 }}>{syncAllOn ? '✓ All visuals synced to music' : '⟳ Sync all to music'}</button>
          <div className="lr-lc-label" style={{ marginBottom: 7 }}>Color sync · theme</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {theme.map((c, i) => (<button type="button" key={i} onClick={() => cycleTheme(i)} title="click to change colour" style={{ flex: 1, height: 30, borderRadius: 8, background: c, border: '2px solid rgba(255,255,255,0.2)', boxShadow: `0 0 10px ${c}66` }} />))}
            <button type="button" onClick={applyTheme} className="btn sm primary" style={{ fontSize: 9.5, padding: '6px 11px' }}>Sync</button>
          </div>
          <div className="mono" style={{ fontSize: 8.5, color: 'var(--muted)', marginTop: 6 }}>3 colours map to spectrum · lasers · background.</div>
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className="lr-lc-led" /><span className="lr-lc-label">Stage select</span><span className="mono" style={{ marginLeft: 'auto', fontSize: 8, color: viz.autoReact ? 'var(--cyan)' : 'var(--muted)' }}>{viz.autoReact ? 'auto-react ●' : 'combine ↻'}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {STAGES.map((st) => {
              const on = stages.includes(st.id);
              return (
                <button type="button" key={st.id} onClick={() => toggleStage(st.id)} title={st.label} className={'lr-lc-cell' + (on ? ' on' : '')}>
                  <span style={{ fontSize: 15, color: on ? 'var(--cyan)' : 'var(--text-2)' }}>{st.glyph}</span>
                  <span className="mono" style={{ fontSize: 7.5, color: on ? 'var(--cyan)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{st.label.split(' ')[0]}</span>
                  <span className={'lr-lc-led' + (on ? '' : ' off')} style={{ width: 5, height: 5 }} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className={'lr-lc-led' + (director === 'off' ? ' off' : '')} style={{ background: director === 'off' ? undefined : 'var(--violet)', boxShadow: director === 'off' ? undefined : '0 0 7px var(--violet)' }} /><span className="lr-lc-label">Auto program</span><span className="mono" style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--muted)' }}>sets modules</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {DIRECTORS.map((d) => {
              const on = director === d.id;
              return (
                <button type="button" key={d.id} onClick={() => setDirector(d.id)} title={d.blurb} className={'lr-lc-cell' + (on ? ' on' : '')}>
                  <span style={{ fontSize: 14, color: on ? 'var(--violet)' : 'var(--text-2)' }}>{d.glyph}</span>
                  <span className="mono" style={{ fontSize: 7.5, color: on ? 'var(--violet)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{d.label}</span>
                  <span className={'lr-lc-led' + (on ? '' : ' off')} style={{ width: 5, height: 5, background: on ? 'var(--violet)' : undefined, boxShadow: on ? '0 0 6px var(--violet)' : undefined }} />
                </button>
              );
            })}
          </div>
          {dirObj && <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.4 }}>{dirObj.blurb}</div>}
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className={'lr-lc-led' + (viz.autoReact ? '' : ' off')} style={{ background: viz.autoReact ? 'var(--cyan)' : undefined, boxShadow: viz.autoReact ? '0 0 7px var(--cyan)' : undefined }} /><span className="lr-lc-label">Auto-react to music</span><span style={{ marginLeft: 'auto' }}><Switch on={viz.autoReact} onChange={(v) => setViz((s) => ({ ...s, autoReact: v }))} /></span></div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.4 }}>Loud, intense parts add layers &amp; push the lasers; quiet parts strip back to one calm visual.</div>
          <div style={{ opacity: viz.autoReact ? 1 : 0.4, pointerEvents: viz.autoReact ? 'auto' : 'none' }}>
            <HSlider label="Sensitivity" value={viz.autoReactSens != null ? viz.autoReactSens : 0.55} min={0} max={1} step={0.01} unit="percent" onChange={(v) => setViz((s) => ({ ...s, autoReactSens: v }))} />
          </div>
          {director !== 'off' && <div className="mono" style={{ fontSize: 8.5, color: 'var(--orange)' }}>Auto program is driving — set it to Manual to use Auto-react.</div>}
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className={'lr-lc-led' + (viz.laserOn ? '' : ' off')} /><span className="lr-lc-label">⚡ Laser rig</span><span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}><SyncTag on={viz.laserSync} onChange={(v) => setViz((s) => ({ ...s, laserSync: v }))} /><Switch on={viz.laserOn} onChange={(v) => setViz((s) => ({ ...s, laserOn: v }))} /></span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="lr-lc-label">Effect</span><div style={{ marginLeft: 'auto' }}><SelectChip value={viz.laserEffect} options={LASER_EFFECTS} onChange={(v) => setViz((s) => ({ ...s, laserEffect: v }))} /></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="lr-lc-label">Pattern</span><div style={{ marginLeft: 'auto' }}><SelectChip value={viz.laserPattern} options={LASER_PATTERNS} onChange={(v) => setViz((s) => ({ ...s, laserPattern: v }))} /></div></div>
          <HSlider label="Intensity" value={viz.laserIntensity / 100} min={0} max={1} step={0.01} unit="percent" onChange={(v) => setViz((s) => ({ ...s, laserIntensity: Math.round(v * 100) }))} />
          <HSlider label="Beams" value={viz.laserBeams} min={6} max={28} step={1} onChange={(v) => setViz((s) => ({ ...s, laserBeams: Math.round(v) }))} />
          <HSlider label="Sweep speed" value={viz.laserSpeed} min={0.3} max={2.5} step={0.05} unit="x" onChange={(v) => setViz((s) => ({ ...s, laserSpeed: v }))} />
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Switch on={viz.laserMove} onChange={(v) => setViz((s) => ({ ...s, laserMove: v }))} accent="var(--violet)" /><span className="mono" style={{ fontSize: 9.5, color: 'var(--text-2)' }}>Roam</span></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Switch on={viz.laserFlash} onChange={(v) => setViz((s) => ({ ...s, laserFlash: v }))} accent="var(--orange)" /><span className="mono" style={{ fontSize: 9.5, color: 'var(--text-2)' }}>Flashes</span></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Switch on={viz.laserMono} onChange={(v) => setViz((s) => ({ ...s, laserMono: v }))} accent="var(--cyan)" /><span className="mono" style={{ fontSize: 9.5, color: 'var(--text-2)' }}>Mono</span></label>
          </div>
          <HueSlider label="Laser color (mono)" value={viz.laserHue} onChange={(h) => setViz((s) => ({ ...s, laserHue: h, laserColor: hslToHex(h) }))} />
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className="lr-lc-led" style={{ background: accentNow, boxShadow: `0 0 7px ${accentNow}` }} /><span className="lr-lc-label">Primary color</span><span style={{ marginLeft: 'auto' }}><SyncTag on={viz.autoColor} onChange={(v) => setViz((s) => ({ ...s, autoColor: v }))} /></span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{PALETTE.map((c) => (<button type="button" key={c} onClick={() => setViz((s) => ({ ...s, barColor: c }))} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: accentNow === c ? '2px solid #fff' : '2px solid transparent', boxShadow: `0 0 8px ${c}66` }} />))}</div>
          <HueSlider value={viz.specHue} onChange={(h) => setViz((s) => ({ ...s, specHue: h, barColor: hslToHex(h) }))} />
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className={'lr-lc-led' + (viz.bgAuto ? '' : ' off')} style={{ background: viz.bgAuto ? 'var(--violet)' : undefined, boxShadow: viz.bgAuto ? '0 0 7px var(--violet)' : undefined }} /><span className="lr-lc-label">Background</span><span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}><SyncTag on={viz.bgSync} onChange={(v) => setViz((s) => ({ ...s, bgSync: v }))} /><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>CYCLE</span><Switch on={viz.bgAuto} onChange={(v) => setViz((s) => ({ ...s, bgAuto: v }))} accent="var(--violet)" /></label></span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: viz.bgAuto ? 0.4 : 1, pointerEvents: viz.bgAuto ? 'none' : 'auto' }}>{PALETTE.map((c) => (<button type="button" key={c} onClick={() => setViz((s) => ({ ...s, bg: c }))} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: (viz.bg || '#00e5b0') === c ? '2px solid #fff' : '2px solid transparent' }} />))}</div>
          <div style={{ opacity: viz.bgAuto ? 0.4 : 1, pointerEvents: viz.bgAuto ? 'none' : 'auto' }}><HueSlider value={viz.bgHue} onChange={(h) => setViz((s) => ({ ...s, bgHue: h, bg: hslToHex(h) }))} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <Switch on={viz.bgFlash} onChange={(v) => setViz((s) => ({ ...s, bgFlash: v }))} accent="var(--orange)" />
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-2)' }}>Flash background</span>
          </div>
          <div style={{ opacity: viz.bgFlash ? 1 : 0.4, pointerEvents: viz.bgFlash ? 'auto' : 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <HSlider label="Flash rate" value={viz.bgFlashHz} min={0.5} max={8} step={0.5} unit="Hz" onChange={(v) => setViz((s) => ({ ...s, bgFlashHz: v }))} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="lr-lc-label">Color</span>{['#ffffff', '#00e5b0', '#a78bfa', '#fb923c', '#f43f5e'].map((c) => (<button type="button" key={c} onClick={() => setViz((s) => ({ ...s, bgFlashColor: c }))} style={{ width: 20, height: 20, borderRadius: 5, background: c, border: viz.bgFlashColor === c ? '2px solid #fff' : '2px solid transparent' }} />))}</div>
          </div>
        </div>

        <div className="lr-lc-bay">
          <div className="lr-lc-bay-hd"><span className={'lr-lc-led' + (viz.dropFx ? '' : ' off')} style={{ background: viz.dropFx ? 'var(--orange)' : undefined, boxShadow: viz.dropFx ? '0 0 7px var(--orange)' : undefined }} /><span className="lr-lc-label">FX · Moments</span></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Switch on={viz.dropFx} onChange={(v) => setViz((s) => ({ ...s, dropFx: v }))} accent="var(--orange)" /><span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>Sync fireworks to drops</span></label>
        </div>
      </div>
    </div>
  );
}

// ── COACH tab — talk to the coach + suggestions that drive the rack ────────
interface CoachReply { text: string; fix?: string; apply?: RackPatch }
function coachReply(q: string): CoachReply {
  const s = q.toLowerCase();
  if (s.includes('loud') || s.includes('limit')) return { text: "You're at −11.2 LUFS integrated; Spotify normalises to −14, so it'll get turned down. Drop the limiter ceiling to −1.0 dBTP and I'll re-check true-peak.", fix: 'limiter ceiling −1.0 dBTP', apply: { limiter: { enabled: true, ceilingDb: -1.0 } } };
  if (s.includes('low') || s.includes('bass') || s.includes('kick')) return { text: 'Sub and kick fundamental overlap around 65 Hz — ~6 dB of punch lost. A −2 dB bell at 120 Hz plus a little sidechain clears it.', fix: 'EQ bell −2 dB @ 120 Hz', apply: { eq: { enabled: true } } };
  if (s.includes('bright') || s.includes('air') || s.includes('high')) return { text: 'Air band (10 kHz+) is ~14% under the genre median. A gentle +2 dB high-shelf at 12 kHz opens it without harshness.', fix: 'high-shelf +2 dB @ 12 kHz', apply: { eq: { enabled: true } } };
  if (s.includes('wide') || s.includes('stereo')) return { text: 'Correlation is +0.71 (healthy) but sub spreads below 120 Hz. Mono-maker at 120 Hz keeps the low end mono-safe.', fix: 'mono-maker @ 120 Hz', apply: { ms: { enabled: true, monoMakerHz: 120 } } };
  return { text: "I'm reading this track's analysis live — ask me about loudness, the low end, brightness, or stereo and I'll suggest a move you can apply right here." };
}

interface CoachMsg { who: 'you' | 'coach'; text: string; fix?: string | undefined; apply?: RackPatch | undefined }
function CoachPanel({ rs, announce }: { rs: RackState; announce?: (text: string, title?: string) => void }) {
  const [applied, setApplied] = useState<Record<number, boolean>>({});
  const [msgs, setMsgs] = useState<CoachMsg[]>([]);
  const [text, setText] = useState('');
  const ask = (q: string) => {
    if (!q.trim()) return;
    const r = coachReply(q);
    setMsgs((m) => [...m, { who: 'you', text: q }, { who: 'coach', text: r.text, fix: r.fix, apply: r.apply }]);
    setText('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(0,229,176,0.07), rgba(167,139,250,0.05))', border: '1px solid rgba(0,229,176,0.28)' }}>
        <Coach size={40} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Coach</div>
          <div className="mono" style={{ fontSize: 8.5, color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ width: 5, height: 5 }} />KNOWS THIS TRACK · 14/26 RUN</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflow: 'auto', paddingRight: 2 }}>
        {msgs.map((m, i) => (
          <div key={i} className="fade-in" style={{ display: 'flex', gap: 8, flexDirection: m.who === 'you' ? 'row-reverse' : 'row' }}>
            {m.who === 'coach' ? <Coach size={24} /> : <Avatar handle="maek" hue={168} size={24} />}
            <div style={{ maxWidth: '82%' }}>
              <div style={{ padding: '8px 11px', borderRadius: 10, fontSize: 11.5, lineHeight: 1.45, color: m.who === 'you' ? '#06151a' : 'var(--text-2)', background: m.who === 'you' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: m.who === 'you' ? 'none' : '1px solid var(--border)' }}>{m.text}</div>
              {m.who === 'coach' && m.apply && (
                <button type="button" onClick={() => { if (m.apply) rs.applyCoach(m.apply); setApplied((a) => ({ ...a, [i]: true })); if (announce) announce(`Applied — ${m.fix}`); }} className="btn sm" style={{ marginTop: 6, color: applied[i] ? 'var(--green)' : 'var(--cyan)', borderColor: applied[i] ? 'rgba(52,211,153,0.4)' : 'rgba(0,229,176,0.4)' }}>{applied[i] ? `✓ Applied — ${m.fix}` : 'Apply suggestion'}</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(text)} placeholder="Ask about your mix…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit' }} />
        <button type="button" onClick={() => ask(text)} className="btn sm primary" style={{ padding: '4px 12px', fontSize: 11 }}>Ask →</button>
      </div>
    </div>
  );
}

// ── PEOPLE tab — who's in the room + their live state ──────────────────────
function PeoplePanel({ myStatus, onReact, cap, roomControl, onGrant }: {
  myStatus: string;
  onReact?: (e: string) => void;
  cap: CapabilitySet;
  roomControl: RoomControl;
  onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span className="dot" style={{ animation: 'pulseGlow 1.6s ease-in-out infinite' }} /><span style={{ fontSize: 13, fontWeight: 700 }}>{ROOM_LISTENERS.length} listening</span></span>
        <button type="button" className="btn ghost sm" style={{ color: 'var(--cyan)', fontSize: 10 }}>↗ Invite</button>
      </div>
      <div style={{ padding: '10px 11px', borderRadius: 9, background: 'rgba(0,229,176,0.05)', border: '1px solid rgba(0,229,176,0.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--cyan)', fontWeight: 700 }}>YOUR STATUS</span>
          <span style={{ fontSize: 18 }}>{myStatus}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {REACTION_GROUPS.map((g) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="mono" style={{ width: 12, textAlign: 'center', fontSize: 12, color: g.tone, fontWeight: 800 }}>{g.sign}</span>
              {g.emojis.map((e) => (
                <button type="button" key={e} onClick={() => onReact && onReact(e)} title={`Set status — ${g.label.toLowerCase()}`} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 14, background: myStatus === e ? `${cssVar(g.tone)}26` : 'rgba(255,255,255,0.02)', border: `1px solid ${myStatus === e ? cssVar(g.tone) : 'var(--border)'}` }}>{e}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>You're hosting — grant <span style={{ color: 'var(--violet)' }}>rack</span> and <span style={{ color: 'var(--cyan)' }}>visuals</span> control to listeners separately.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {ROOM_LISTENERS.map((u) => (
          <div key={u.handle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: `1px solid ${u.you ? 'rgba(0,229,176,0.4)' : 'var(--border)'}` }}>
            <Avatar handle={u.handle} hue={u.hue} anon={u.anon} size={26} />
            <span className="mono" style={{ fontSize: 11, color: u.you ? 'var(--cyan)' : 'var(--text-2)' }}>{u.anon ? 'anonymous' : '@' + u.handle}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {u.you && <span className="mono" style={{ fontSize: 8.5, color: 'var(--cyan)', letterSpacing: '0.1em' }}>HOST</span>}
              {!u.you && (() => {
                const actor: ActorRef = { type: u.anon ? 'anon' : 'user', handle: u.handle, hue: u.hue };
                const isDJ = sameActor(roomControl.rackHolder, actor);
                const isVJ = sameActor(roomControl.visualsHolder, actor);
                return (
                  <>
                    {isDJ
                      ? <span className="mono" style={{ fontSize: 7.5, color: 'var(--violet)', padding: '2px 5px', borderRadius: 5, border: '1px solid rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.08)' }}>● DJ</span>
                      : cap.canGrantControl && <button type="button" onClick={() => onGrant('rack', actor)} className="btn ghost sm" style={{ fontSize: 8, padding: '3px 6px', color: 'var(--muted)' }}>+ DJ</button>}
                    {isVJ
                      ? <span className="mono" style={{ fontSize: 7.5, color: 'var(--cyan)', padding: '2px 5px', borderRadius: 5, border: '1px solid rgba(0,229,176,0.4)', background: 'rgba(0,229,176,0.08)' }}>● VJ</span>
                      : cap.canGrantControl && <button type="button" onClick={() => onGrant('visuals', actor)} className="btn ghost sm" style={{ fontSize: 8, padding: '3px 6px', color: 'var(--muted)' }}>+ Vis</button>}
                  </>
                );
              })()}
              <span style={{ fontSize: 14 }} title="current status">{u.you ? myStatus : u.state}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CHAT tab — comments + reactions ────────────────────────────────────────
const SEED_CHAT = [
  { id: 's1', handle: 'vela', text: 'the breakdown reverb is unreal', t: 130 },
  { id: 's2', handle: 'forge', text: 'kick could hit harder imo', t: 70 },
];
interface ChatStreamItem { id: string; handle: string; text?: string | undefined; emoji?: string | undefined; t?: number | undefined; you?: boolean | undefined; kind: 'react' | 'chat' }
function ChatPanel({ feed, onReact }: { feed: ReactionFeedItem[]; onReact: (e: string) => void }) {
  const [msgs, setMsgs] = useState<ChatStreamItem[]>([]);
  const [text, setText] = useState('');
  const stream: ChatStreamItem[] = [
    ...feed.map((f) => ({ id: f.id, handle: f.handle, text: f.text, emoji: f.emoji, t: f.t, you: f.you, kind: 'react' as const })),
    ...msgs,
    ...SEED_CHAT.map((c) => ({ ...c, kind: 'chat' as const })),
  ];
  const send = () => {
    if (!text.trim()) return;
    setMsgs((m) => [{ id: Math.random().toString(36).slice(2), handle: 'maek', text: text.trim(), kind: 'chat', you: true }, ...m]);
    setText('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, overflow: 'auto', maxHeight: 320 }}>
        {stream.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>Say something or drop a reaction — the whole room sees it.</div>}
        {stream.map((m) => {
          const u = ROOM_LISTENERS.find((x) => x.handle === m.handle);
          return (
            <div key={m.id} className="fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              {m.emoji ? <span style={{ fontSize: 15 }}>{m.emoji}</span> : <Avatar handle={m.handle} hue={u ? u.hue : 200} anon={u ? u.anon : false} size={20} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 10, color: m.you ? 'var(--cyan)' : 'var(--violet)' }}>@{m.handle}</span>
                {m.text && <span style={{ fontSize: 11.5, color: 'var(--text-2)', marginLeft: 6 }}>{m.text}</span>}
                {!m.text && m.kind === 'react' && <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginLeft: 6 }}>reacted</span>}
              </div>
              {m.t != null && <span className="mono" style={{ fontSize: 8.5, color: 'var(--muted)' }}>{fmtTime(m.t)}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {REACTION_GROUPS.map((g) => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="mono" title={g.label} style={{ width: 12, textAlign: 'center', fontSize: 12, color: g.tone, fontWeight: 800 }}>{g.sign}</span>
            {g.emojis.map((e) => (
              <button type="button" key={e} onClick={() => onReact(e)} style={{ flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 15, background: `${cssVar(g.tone)}10`, border: `1px solid ${cssVar(g.tone)}2a` }}>{e}</button>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Say something…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit' }} />
        <button type="button" onClick={send} className="btn sm primary" style={{ padding: '4px 10px', fontSize: 11 }}>Send</button>
      </div>
    </div>
  );
}

// ── STATS tab — song facts from the analysis ───────────────────────────────
function StatRow({ label, value, tone = 'var(--text)' }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: tone }}>{value}</span>
    </div>
  );
}
function StatsPanel({ track }: { track: Track }) {
  const dur = `${Math.floor(track.durationSec / 60)}:${String(track.durationSec % 60).padStart(2, '0')}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <PLabel accent="var(--cyan)">From the analysis</PLabel>
      <StatRow label="Genre" value={`${track.genre.name} · ${track.genre.confidence}%`} tone="var(--cyan)" />
      <StatRow label="Tempo" value={`${track.bpm} BPM`} />
      <StatRow label="Key" value={track.key} />
      <StatRow label="Duration" value={dur} />
      <StatRow label="Integrated" value={`${track.loudness.integrated.toFixed(1)} LUFS`} />
      <StatRow label="True peak" value={`${track.loudness.truePeak.toFixed(1)} dBTP`} />
      <StatRow label="Dynamic range" value={`${track.loudness.dynamicRange.toFixed(1)} LU`} />
      <StatRow label="RMS" value={`${track.loudness.rms.toFixed(1)} dB`} />
      <StatRow label="Stereo width" value={`${track.stereo.width}%`} />
      <StatRow label="Correlation" value={`+${track.stereo.correlation.toFixed(2)}`} tone={track.stereo.correlation < 0 ? 'var(--red)' : 'var(--cyan)'} />
      <StatRow label="Mono compat" value={`${Math.round(track.stereo.monoCompat * 100)}%`} />
      <StatRow label="Sections" value={`${track.arrangement.sections.length}`} />
      <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.28)' }}>
        <div className="mono" style={{ fontSize: 9, color: 'var(--orange)', letterSpacing: '0.1em', fontWeight: 700 }}>VS SPOTIFY −14 LUFS</div>
        <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--orange)', marginTop: 3 }}>+{(track.loudness.integrated - (-14)).toFixed(1)} LU over</div>
      </div>
    </div>
  );
}

// ── NOTES tab — private session notes ──────────────────────────────────────
function NotesPanel({ track, position, activeNote, onNoteClick }: {
  track: Track; position: number; activeNote: string | null; onNoteClick: (n: TrackNote) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <PLabel accent="var(--cyan)">Session notes · {track.notes.length}</PLabel>
        <span className="pill">Private</span>
      </div>
      {track.notes.map((n) => {
        const active = activeNote === n.id, c = n.pinned ? 'var(--cyan)' : 'var(--violet)';
        return (
          <button type="button" key={n.id} onClick={() => onNoteClick(n)} style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8, background: active ? 'rgba(0,229,176,0.05)' : 'transparent', border: active ? '1px solid rgba(0,229,176,0.32)' : '1px solid transparent' }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: `${cssVar(c)}14`, border: `1px solid ${cssVar(c)}44`, color: c, display: 'grid', placeItems: 'center', fontSize: 12, flexShrink: 0 }}>{n.pinned ? '★' : '·'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="mono" style={{ fontSize: 9.5, color: c }}>@{fmtTime(n.t)}</span>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.4 }}>{n.text}</div>
            </div>
          </button>
        );
      })}
      <div style={{ marginTop: 6, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.32)', color: 'var(--cyan)', display: 'grid', placeItems: 'center', fontSize: 12 }}>+</span>
        <input placeholder="Note this moment…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 11.5, fontFamily: 'inherit' }} />
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--cyan)' }}>@ {fmtTime(position)}</span>
      </div>
    </div>
  );
}

// ── PLAN tab — actionable fixes from the analysis ──────────────────────────
function PlanPanel({ rs, announce }: { rs: RackState; announce?: (text: string, title?: string) => void }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PLabel accent="var(--cyan)">Your plan · from the analysis</PLabel>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>{PLAN_ITEMS.length} fixes ranked by impact · apply drives the rack</div>
      {PLAN_ITEMS.map((p, i) => {
        const d = done[p.id];
        return (
          <div key={p.id} style={{ padding: 12, borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: `1px solid ${cssVar(p.color)}33`, borderLeft: `3px solid ${p.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 800, color: p.color }}>{String(i + 1).padStart(2, '0')}</span>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: p.color, fontWeight: 700 }}>{p.tag}</span>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4, lineHeight: 1.3 }}>{p.title}</div>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4 }}>{p.detail}</div>
            <button type="button" onClick={() => { rs.applyCoach(p.apply); setDone((s) => ({ ...s, [p.id]: true })); if (announce) announce(`Applied — ${p.fix}`); }} className="btn sm" style={{ marginTop: 10, width: '100%', justifyContent: 'center', color: d ? 'var(--green)' : 'var(--cyan)', borderColor: d ? 'rgba(52,211,153,0.4)' : 'rgba(0,229,176,0.4)' }}>{d ? '✓ Applied' : 'Apply fix'}</button>
          </div>
        );
      })}
    </div>
  );
}

// ── COMMENTS tab — async View feedback thread (timestamped + suggestions) ──
function CommentsPanel({ access, onSeek }: { access: AccessDto; onSeek: (t: number) => void }) {
  const [comments] = useState<CommentDto[]>(MOCK_COMMENTS);
  const [text, setText] = useState('');
  const sevColor = (s: CommentDto['status']) => s === 'pinned' ? 'var(--cyan)' : s === 'resolved' ? 'var(--green)' : 'var(--violet)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <PLabel accent="var(--violet)">Feedback · {comments.length}</PLabel>
        <span className="pill violet">Async review</span>
      </div>
      {comments.map((c) => {
        const tone = sevColor(c.status);
        const name = c.author.handle ?? c.author.displayName ?? 'anon';
        return (
          <div key={c.id} style={{ padding: '10px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: `1px solid ${cssVar(tone)}2e`, borderLeft: `3px solid ${tone}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar handle={name} hue={c.author.hue ?? 200} anon={c.author.type === 'anon'} size={22} />
              <span className="mono" style={{ fontSize: 10.5, color: c.author.type === 'anon' ? 'var(--muted)' : 'var(--violet)' }}>{c.author.type === 'anon' ? name : '@' + name}</span>
              {c.t != null && <button type="button" onClick={() => onSeek(c.t as number)} className="mono" style={{ fontSize: 9.5, color: 'var(--cyan)', background: 'none', padding: 0 }}>@{fmtTime(c.t)}</button>}
              {c.status === 'pinned' && <span className="mono" style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--cyan)', letterSpacing: '0.1em' }}>★ PINNED</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.45 }}>{c.body}</div>
            {c.suggestionId && (
              <div className="mono" style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--cyan)', padding: '3px 8px', borderRadius: 6, border: '1px dashed rgba(0,229,176,0.35)', background: 'rgba(0,229,176,0.05)' }}>⌁ suggested a rack chain · audition</div>
            )}
          </div>
        );
      })}
      {access.gates.canComment ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave feedback…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit' }} />
            <button type="button" onClick={() => setText('')} className="btn sm primary" style={{ padding: '4px 12px', fontSize: 11 }}>Post</button>
          </div>
          {access.gates.canSuggest && <div className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>The rack is read-only here — edit it to <span style={{ color: 'var(--cyan)' }}>fork &amp; suggest a chain</span>.</div>}
        </div>
      ) : (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Comments are closed on this track.</div>
      )}
    </div>
  );
}

// ── the panel shell ────────────────────────────────────────────────────────
const TAB_LABELS: Record<string, string> = {
  coach: 'Coach', plan: 'Plan', comments: 'Comments', people: 'People', chat: 'Chat', stats: 'Stats', notes: 'Notes',
};

export function RightRail({ mode, access, cap, rs, track, position, activeNote, onNoteClick, onSeek, onReact, feed, announce, myStatus, roomControl, onGrant }: {
  mode: ModeId;
  access: AccessDto;
  cap: CapabilitySet;
  rs: RackState;
  track: Track;
  position: number;
  activeNote: string | null;
  onNoteClick: (n: TrackNote) => void;
  onSeek: (t: number) => void;
  onReact: (e: string) => void;
  feed: ReactionFeedItem[];
  announce: (text: string, title?: string) => void;
  myStatus: string;
  roomControl: RoomControl;
  onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
}) {
  const tabs = railTabsFor(mode, access);
  const [tab, setTab] = useState(tabs[0]);
  // Reset to the first valid tab whenever the mode's tab set changes.
  useEffect(() => { setTab(tabs[0]); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = tabs.includes(tab) ? tab : tabs[0];
  return (
    <div className="card" style={{ padding: 14, position: 'sticky', top: 16, alignSelf: 'start', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 32px)' }}>
      <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map((id) => (
          <button type="button" key={id} onClick={() => setTab(id)} className="mono" style={{ flex: '1 1 auto', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em', padding: '6px 4px', borderRadius: 6, color: active === id ? 'var(--text)' : 'var(--muted)', background: active === id ? 'var(--card-hover)' : 'transparent', boxShadow: active === id ? 'inset 0 0 0 1px var(--border)' : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {TAB_LABELS[id] ?? id}{(id === 'chat' || id === 'people') && mode === 'room' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--violet)', boxShadow: '0 0 6px var(--violet)' }} />}
          </button>
        ))}
      </div>
      <div style={{ overflow: 'auto', flex: 1, paddingRight: 2 }}>
        {active === 'coach' && <CoachPanel rs={rs} announce={announce} />}
        {active === 'plan' && <PlanPanel rs={rs} announce={announce} />}
        {active === 'comments' && <CommentsPanel access={access} onSeek={onSeek} />}
        {active === 'people' && <PeoplePanel myStatus={myStatus} onReact={onReact} cap={cap} roomControl={roomControl} onGrant={onGrant} />}
        {active === 'chat' && <ChatPanel feed={feed} onReact={onReact} />}
        {active === 'stats' && <StatsPanel track={track} />}
        {active === 'notes' && <NotesPanel track={track} position={position} activeNote={activeNote} onNoteClick={onNoteClick} />}
      </div>
    </div>
  );
}
