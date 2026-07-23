/* SPECTR · Listen rack redesign — right panel (tabs) + collapsible visual meters
 * Tabs: Coach · Plan · People · Chat · Stats · Notes.
 *
 * SWAP BOUNDARY (see PORTING_NOTES.md):
 *   useLiveMeters → real loudness/stereo selectors (AnalyserNode follower).
 *   coachReply    → real coach analysis feed (each item keeps an `apply` patch).
 *   People/Chat   → real-time presence + messages + grant-control.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from '@tanstack/react-router';

import {
  railTabsFor, type AccessDto, type ActorRef, type ModeId,
} from './access';
import {
  BG_COLORS, DIRECTORS, LASER_EFFECTS, LASER_PATTERNS, REACTION_GROUPS,
  ROOM_LISTENERS, STAGES, type RackPatch, type ReactionFeedItem, type Track, type TrackNote, type VizState,
} from './data';
import { Coach } from '../../ui/Coach';
import type { AudioFrame } from '../listen/useAudioGraph';
import { cssVar, fmtTime, hslToHex } from './helpers';
import type { CapabilitySet } from './capabilities';
import { sameActor, type RoomControl } from './identity';
import type { RackState } from './rackState';
import { Avatar, HSlider, HueSlider, SelectChip, Switch } from './ui';
import { readListenFixes, type ListenFix } from './listenFixes';
import { useFixOverlay } from './useFixOverlay';
import {
  useComments, usePostComment, usePatchCommentStatus, useDeleteComment,
} from '../listen/useComments';
import { buildCommentThreads, canModerate } from '../listen/comment-tree';
import { useSuggestions } from '../listen/useSuggestions';
import { partitionSuggestions } from '../listen/suggestion-helpers';
import { SuggestionCard, type SuggestionAuditionSeam } from '../listen/SuggestionCard';
import { useMe } from '../../api/hooks';
import type { CommentDto as ApiCommentDto } from '../../api/types';
import { useMentionAutocomplete } from '../mentions/useMentionAutocomplete';
import { MentionSuggestList } from '../mentions/MentionSuggestList';

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
            <HSlider label="Flash rate" value={viz.bgFlashHz} min={0.5} max={3} step={0.5} unit="Hz" onChange={(v) => setViz((s) => ({ ...s, bgFlashHz: v }))} />
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

// ── Wave-3 E6.3/E6.4/E6.5 — provenance handles threaded from the route ─────
/** The song's latest report — powers "View Report" + the coach hand-off link. */
export interface ReportRef { songId: string; jobId: string }
/** Which analysis feeds the Stats rail (E6.3 mismatch labeling). */
export interface StatsSource { mismatch: boolean; versionNumber: number | null }

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
export function CoachPanel({ rs, announce, real = false, reportRef = null }: {
  rs: RackState; announce?: (text: string, title?: string) => void;
  /** Wave-3 E6.4 — real-audio route: NO canned coachReply, NO fixture badge;
   *  honest hand-off to the report's real AI coach instead. */
  real?: boolean;
  reportRef?: ReportRef | null;
}) {
  const [applied, setApplied] = useState<Record<number, boolean>>({});
  const [msgs, setMsgs] = useState<CoachMsg[]>([]);
  const [text, setText] = useState('');
  const ask = (q: string) => {
    if (!q.trim()) return;
    const r = coachReply(q);
    setMsgs((m) => [...m, { who: 'you', text: q }, { who: 'coach', text: r.text, fix: r.fix, apply: r.apply }]);
    setText('');
  };
  if (real) {
    // E6.4 — the canned coachReply fabricates measurements ("−11.2 LUFS") that
    // have nothing to do with THIS track. On a real version the rack coach is
    // simply not live yet: say so, and point at the report's grounded coach.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="coach-real-honest">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(0,229,176,0.07), rgba(167,139,250,0.05))', border: '1px solid rgba(0,229,176,0.28)' }}>
          <Coach size={40} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Coach</div>
          </div>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          The rack coach isn&rsquo;t live yet. Your real AI coach — grounded in this
          track&rsquo;s measured analysis — is on the report.
        </div>
        {reportRef && (
          <Link
            to="/songs/$songId/results/$jobId"
            params={{ songId: reportRef.songId, jobId: reportRef.jobId }}
            className="btn sm"
            style={{ alignSelf: 'flex-start', color: 'var(--cyan)', borderColor: 'rgba(0,229,176,0.4)' }}
          >
            Open the report&rsquo;s AI Coach →
          </Link>
        )}
      </div>
    );
  }
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
            {/* Story 11.11 — non-anon listeners deep-link to /u/{handle}. */}
            {u.anon ? (
              <>
                <Avatar handle={u.handle} hue={u.hue} anon size={26} />
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>anonymous</span>
              </>
            ) : (
              <a href={`/u/${u.handle}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                <Avatar handle={u.handle} hue={u.hue} size={26} />
                <span className="mono" style={{ fontSize: 11, color: u.you ? 'var(--cyan)' : 'var(--text-2)' }}>@{u.handle}</span>
              </a>
            )}
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
export function StatsPanel({ track, statsSource = null }: {
  track: Track;
  /** Wave-3 E6.3 — set when the stats come from a DIFFERENT version's analysis. */
  statsSource?: StatsSource | null;
}) {
  const dur = `${Math.floor(track.durationSec / 60)}:${String(track.durationSec % 60).padStart(2, '0')}`;
  // E6.2 — no completed analysis: every number below would be a placeholder
  // zero presented as a measurement. Say so instead.
  if (!track.analyzed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PLabel accent="var(--cyan)">From the analysis</PLabel>
        <div className="mono" data-testid="stats-not-analyzed" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          Not analyzed yet — run an analysis from the song page.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <PLabel accent="var(--cyan)">From the analysis</PLabel>
      {statsSource?.mismatch && (
        <div className="mono" data-testid="stats-mismatch-note" style={{ fontSize: 9.5, color: 'var(--orange)', lineHeight: 1.5, margin: '2px 0 6px' }}>
          Stats are from the latest analysis{statsSource.versionNumber != null ? ` (v${statsSource.versionNumber})` : ''}, not the version you&rsquo;re hearing.
        </div>
      )}
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
function NotesPanel({ track, activeNote, onNoteClick }: {
  track: Track; activeNote: string | null; onNoteClick: (n: TrackNote) => void;
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
      {/* Story 12.5: the "Note this moment" input is GONE — notes are
          read-only today (no create-note endpoint); a dead input teaches
          users to stop typing. Restore alongside a real notes-write API. */}
    </div>
  );
}

// ── PLAN tab — the user's Added fixes, each a checkbox that applies that one
// fix to the live rack (recompute-from-baseline; uncheck to compare). ────────
export function PlanPanel({ rs, versionId }: { rs: RackState; versionId?: string }) {
  const fixes: ListenFix[] = useMemo(
    () => (versionId ? readListenFixes(versionId) : []),
    [versionId],
  );
  const { isApplied, toggle } = useFixOverlay({
    versionId: versionId ?? '',
    fixes,
    applyRackMod: rs.applyRackMod,
    // Story 12.4 (AC4): baseline = the LIVE rack at first apply, so manual
    // knob moves survive the overlay and return when everything unchecks.
    getLiveMod: () => rs.mod,
  });

  if (fixes.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PLabel accent="var(--cyan)">Your plan · from the analysis</PLabel>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          Add fixes on the Results page to apply them here. Each one becomes a checkbox you can toggle to A/B against your track.
        </div>
      </div>
    );
  }

  const sevColor = (sev: string) =>
    sev === 'crit' ? 'var(--orange)' : sev === 'warn' ? 'var(--violet)' : 'var(--cyan)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PLabel accent="var(--cyan)">Your plan · {fixes.length} fixes</PLabel>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>
        Check a fix to apply it to the rack — uncheck to compare.
      </div>
      {fixes.map((f) => {
        const na = f.notApplicable === true;
        const on = !na && isApplied(f.fixId);
        const c = sevColor(f.sev);
        const modules = [...new Set(f.ops.map((o) => o.type))].join(' · ');
        return (
          <label
            key={f.fixId}
            data-testid={na ? 'plan-fix-na' : 'plan-fix'}
            style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 9, cursor: na ? 'default' : 'pointer', opacity: na ? 0.55 : 1, background: on ? 'rgba(0,229,176,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${cssVar(c)}33`, borderLeft: `3px solid ${c}` }}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={na}
              onChange={() => toggle(f.fixId)}
              style={{ marginTop: 2, accentColor: 'var(--cyan)' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {f.scope && <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: c, fontWeight: 700 }}>{f.scope.toUpperCase()}</div>}
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{f.title}</div>
              {na ? (
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4 }}>
                  not applicable in the rack — take it back to your DAW
                </div>
              ) : (
                modules && <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4 }}>{modules}</div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ── COMMENTS tab — async View feedback thread (timestamped + suggestions) ──
// Story 11.1: real PRP-3 comments (useComments). Gating is server-side via
// AccessService — a 403/404 from the query renders the "not permitted" state.
export function CommentsPanel({ versionId, access, isOwner, position, onSeek, onForkToSuggest, audition }: {
  versionId?: string;
  access: AccessDto;
  isOwner: boolean;
  position: number;
  onSeek: (t: number) => void;
  /** Story 11.12 — engages fork-to-suggest on the page (owns the rack state).
   *  Absent (mock route / no rack) hides the affordance. */
  onForkToSuggest?: () => void;
  /** Story 11.12 — audition seam threaded to each SuggestionCard. */
  audition?: SuggestionAuditionSeam;
}) {
  const vid = versionId ?? '';
  const commentsQ = useComments(vid);
  const me = useMe(Boolean(vid));
  const postMut = usePostComment(vid);
  const patchMut = usePatchCommentStatus(vid);
  const delMut = useDeleteComment(vid);
  const [text, setText] = useState('');
  const [pinTime, setPinTime] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Story 11.11 — @handle autocomplete; keydown routes through the dropdown
  // first so Enter picks a suggestion instead of submitting.
  const commentInputRef = useRef<HTMLInputElement>(null);
  const mention = useMentionAutocomplete(setText, commentInputRef);

  const suggestionsQ = useSuggestions(vid);
  const { byCommentId: suggestionByComment, standalone: standaloneSuggestions } = useMemo(
    () => partitionSuggestions(suggestionsQ.data ?? []),
    [suggestionsQ.data],
  );

  const meId = me.data?.id ?? null;
  const threads = useMemo(() => buildCommentThreads(commentsQ.data ?? []), [commentsQ.data]);
  const total = threads.reduce((n, th) => n + 1 + th.replies.length, 0);
  const sevColor = (s: ApiCommentDto['status']) =>
    s === 'pinned' ? 'var(--cyan)' : s === 'resolved' ? 'var(--green)' : s === 'hidden' ? 'var(--muted)' : 'var(--violet)';

  const submit = () => {
    const body = text.trim();
    // Guard against a double-submit: the Post button is disabled while a post is
    // in flight, but the Enter-key handler reaches here directly (review 11.1).
    if (!body || !vid || postMut.isPending) return;
    postMut.mutate(
      { body, t: pinTime && Number.isFinite(position) ? Math.round(position) : null, parentId: replyTo },
      { onSuccess: () => { setText(''); mention.close(); setPinTime(false); setReplyTo(null); } },
    );
  };

  const renderComment = (c: ApiCommentDto, isReply: boolean) => {
    const tone = sevColor(c.status);
    const name = c.author.handle ?? c.author.displayName ?? 'anon';
    const mod = canModerate(c, meId, isOwner);
    return (
      <div key={c.id} style={{ marginLeft: isReply ? 16 : 0, padding: '10px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: `1px solid ${cssVar(tone)}2e`, borderLeft: `3px solid ${tone}`, opacity: c.status === 'hidden' ? 0.55 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Story 11.11 — authed authors deep-link to their public profile. */}
          {c.author.type === 'user' && c.author.handle ? (
            <a href={`/u/${c.author.handle}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
              <Avatar handle={name} hue={c.author.hue ?? 200} size={22} />
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--violet)' }}>@{name}</span>
            </a>
          ) : (
            <>
              <Avatar handle={name} hue={c.author.hue ?? 200} anon={c.author.type === 'anon'} size={22} />
              <span className="mono" style={{ fontSize: 10.5, color: c.author.type === 'anon' ? 'var(--muted)' : 'var(--violet)' }}>{c.author.type === 'anon' ? name : '@' + name}</span>
            </>
          )}
          {c.t != null && <button type="button" onClick={() => onSeek(c.t as number)} className="mono" style={{ fontSize: 9.5, color: 'var(--cyan)', background: 'none', padding: 0 }}>@{fmtTime(c.t)}</button>}
          {c.status === 'pinned' && <span className="mono" style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--cyan)', letterSpacing: '0.1em' }}>★ PINNED</span>}
          {c.status === 'resolved' && <span className="mono" style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--green)', letterSpacing: '0.1em' }}>✓ RESOLVED</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.45 }}>{c.body}</div>
        {suggestionByComment.has(c.id) ? (
          <SuggestionCard suggestion={suggestionByComment.get(c.id)!} versionId={vid} isOwner={isOwner} {...(audition ? { audition } : {})} />
        ) : c.suggestionId ? (
          <div className="mono" style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--cyan)', padding: '3px 8px', borderRadius: 6, border: '1px dashed rgba(0,229,176,0.35)', background: 'rgba(0,229,176,0.05)' }}>⌁ suggested a rack chain</div>
        ) : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
          {!isReply && access.gates.canComment && (
            <button type="button" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="mono" style={{ fontSize: 9, color: replyTo === c.id ? 'var(--cyan)' : 'var(--muted)', background: 'none', padding: 0 }}>reply</button>
          )}
          {mod && (
            <>
              <button type="button" onClick={() => patchMut.mutate({ commentId: c.id, body: { status: c.status === 'resolved' ? 'open' : 'resolved' } })} className="mono" style={modBtn}>{c.status === 'resolved' ? 'reopen' : 'resolve'}</button>
              <button type="button" onClick={() => patchMut.mutate({ commentId: c.id, body: { status: c.status === 'pinned' ? 'open' : 'pinned' } })} className="mono" style={modBtn}>{c.status === 'pinned' ? 'unpin' : 'pin'}</button>
              {c.status !== 'hidden' && <button type="button" onClick={() => patchMut.mutate({ commentId: c.id, body: { status: 'hidden' } })} className="mono" style={modBtn}>hide</button>}
              <button type="button" onClick={() => delMut.mutate(c.id)} className="mono" style={{ ...modBtn, color: 'var(--red)' }}>delete</button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <PLabel accent="var(--violet)">Feedback · {total}</PLabel>
        <span className="pill violet">Async review</span>
      </div>

      {standaloneSuggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label" style={{ fontSize: 9, color: 'var(--muted)' }}>Suggested fixes</span>
          {standaloneSuggestions.map((sg) => (
            <SuggestionCard key={sg.id} suggestion={sg} versionId={vid} isOwner={isOwner} {...(audition ? { audition } : {})} />
          ))}
        </div>
      )}

      {commentsQ.isLoading ? (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Loading feedback…</div>
      ) : commentsQ.isError ? (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Couldn&rsquo;t load feedback for this track.</div>
      ) : threads.length === 0 ? (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>No feedback yet.</div>
      ) : (
        threads.map((th) => (
          <div key={th.comment.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {renderComment(th.comment, false)}
            {th.replies.map((r) => renderComment(r, true))}
          </div>
        ))
      )}

      {access.gates.canComment ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {replyTo && <div className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>replying… <button type="button" onClick={() => setReplyTo(null)} style={{ color: 'var(--cyan)', background: 'none', padding: 0 }}>cancel</button></div>}
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
              {mention.open && (
                <MentionSuggestList items={mention.items} activeIndex={mention.activeIndex} onPick={mention.pick} />
              )}
              <input ref={commentInputRef} value={text} onChange={(e) => { setText(e.target.value); mention.onChange(e.target.value, e.target.selectionStart); }} onKeyDown={(e) => { if (mention.handleKeyDown(e)) return; if (!e.nativeEvent.isComposing && e.key === 'Enter') submit(); }} onBlur={mention.close} placeholder={replyTo ? 'Reply…' : 'Leave feedback…'} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit' }} />
            </div>
            <button type="button" onClick={() => setPinTime((p) => !p)} title="pin to current time" className="mono" style={{ fontSize: 9.5, color: pinTime ? 'var(--cyan)' : 'var(--muted)', background: 'none', padding: 0 }}>@{fmtTime(position)}</button>
            <button type="button" onClick={submit} disabled={postMut.isPending || !text.trim()} className="btn sm primary" style={{ padding: '4px 12px', fontSize: 11 }}>Post</button>
          </div>
        </div>
      ) : (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>Comments are closed on this track.</div>
      )}

      {/* 11.12: OUTSIDE the canComment branch — a canSuggest-without-canComment
          grant must still get the rail fork seam (review finding). */}
      {access.gates.canSuggest && onForkToSuggest && (
        <button
          type="button"
          data-testid="fork-to-suggest"
          className="mono"
          onClick={onForkToSuggest}
          style={{ alignSelf: 'flex-start', fontSize: 9, color: 'var(--cyan)', background: 'rgba(0,229,176,0.05)', border: '1px dashed rgba(0,229,176,0.35)', borderRadius: 6, padding: '4px 9px' }}
        >
          ⌁ Fork the rack &amp; suggest a chain
        </button>
      )}
    </div>
  );
}

const modBtn: React.CSSProperties = { fontSize: 9, color: 'var(--muted)', background: 'none', padding: 0 };

// ── the panel shell ────────────────────────────────────────────────────────
const TAB_LABELS: Record<string, string> = {
  coach: 'Coach', plan: 'Plan', comments: 'Comments', people: 'People', chat: 'Chat', stats: 'Stats', notes: 'Notes',
};

export function RightRail({ mode, access, cap, rs, track, position, activeNote, onNoteClick, onSeek, onReact, feed, announce, myStatus, roomControl, onGrant, versionId, isOwner = false, onForkToSuggest, audition, real = false, reportRef = null, statsSource = null }: {
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
  versionId?: string;
  isOwner?: boolean;
  /** Story 11.12 — fork-to-suggest + audition seams, forwarded to CommentsPanel. */
  onForkToSuggest?: () => void;
  audition?: SuggestionAuditionSeam;
  /** Wave-3 — real-audio route flag (E6.4) + provenance handles (E6.3/E6.5). */
  real?: boolean;
  reportRef?: ReportRef | null;
  statsSource?: StatsSource | null;
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
        {active === 'coach' && <CoachPanel rs={rs} announce={announce} real={real} reportRef={reportRef} />}
        {active === 'plan' && <PlanPanel rs={rs} {...(versionId ? { versionId } : {})} />}
        {active === 'comments' && <CommentsPanel access={access} onSeek={onSeek} isOwner={isOwner} position={position} {...(versionId ? { versionId } : {})} {...(onForkToSuggest ? { onForkToSuggest } : {})} {...(audition ? { audition } : {})} />}
        {active === 'people' && <PeoplePanel myStatus={myStatus} onReact={onReact} cap={cap} roomControl={roomControl} onGrant={onGrant} />}
        {active === 'chat' && <ChatPanel feed={feed} onReact={onReact} />}
        {active === 'stats' && <StatsPanel track={track} statsSource={statsSource} />}
        {active === 'notes' && <NotesPanel track={track} activeNote={activeNote} onNoteClick={onNoteClick} />}
      </div>
    </div>
  );
}
