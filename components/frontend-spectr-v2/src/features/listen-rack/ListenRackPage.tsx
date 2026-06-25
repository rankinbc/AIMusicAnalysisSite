/* SPECTR · Listen — Rack & Visuals redesign (ported page container)
 *
 * Viz-dominant layout: big host-driven stage + collapsible visual-meters
 * overlay, rich InlineRack below (swappable with the Visuals console), and a
 * tabbed right rail. Owns all top-level orchestration state.
 *
 * NOTE: the SPECTR TopNav from the prototype is intentionally NOT rendered here
 * — this page mounts inside the real `_app` layout, whose top bar already IS the
 * design's nav (brand · Report/Listen/Library · search · Upload · avatar).
 *
 * The playback clock, presence/reactions, coach, and meters are all MOCK
 * (rAF + setInterval + fixtures). See PORTING_NOTES.md for the wiring map.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import { useAudioGraph } from '../listen/useAudioGraph';
import { CoverArt } from '../../ui/CoverArt';
import {
  MODE_SURFACE_MATRIX, type AccessDto, type ActorRef, type ModeId,
} from './access';
import { resolveCapabilities } from './capabilities';
import { type Identity, type RoomControl } from './identity';
import {
  DIRECTORS, LASER_EFFECTS, LASER_PATTERNS, MANIFEST_BY_ID, ROOM_LISTENERS, REACTION_EMOJI, TRACK,
  type AnnouncementMsg, type Director, type ModuleManifest, type PresencePopItem,
  type ReactionFeedItem, type VizState, DEFAULT_VIZ,
} from './data';
import { hslToHex } from './helpers';
import './listenRack.css';
import { InlineRack } from './rackLayouts';
import { RightRail, VisualMeters, VisualsPanel } from './rail';
import { useRackState, type RackPreset } from './rackState';
import { Transport } from './transport';
import { Coach } from '../../ui/Coach';
import { Avatar, SegBar } from './ui';
import { VizStage } from './viz';

interface VizPreset { id: string; name: string; viz: VizState; stages: string[]; director: string }

function TrackHeader({ mode, modes, identity, onModeChange }: {
  mode: ModeId; modes: ModeId[]; identity: Identity; onModeChange?: (m: ModeId) => void;
}) {
  const t = TRACK;
  const surface = MODE_SURFACE_MATRIX[mode];
  const showSwitcher = identity.isOwner && onModeChange && modes.length > 1;
  return (
    <div className="lr-head">
      <CoverArt hue={168} size="md" />
      <div className="lr-head-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', letterSpacing: '0.14em' }}>NOW PLAYING</span>
          <span className="dot" style={{ animation: 'pulseGlow 1.6s ease-in-out infinite' }} />
        </div>
        <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.015em', margin: '0 0 3px' }}>{t.name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <Avatar handle={t.author} hue={168} size={20} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>by {t.author}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{t.handle}</span>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill cyan">{t.genre.name}</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>{surface.blurb}</span>
        </div>
      </div>
      <div className="lr-head-actions">
        {showSwitcher && (
          <SegBar value={mode} onChange={(id) => onModeChange(id as ModeId)}
            options={modes.map((id) => ({ id, label: MODE_SURFACE_MATRIX[id].label }))} accent={surface.accent} />
        )}
        <button type="button" className="btn primary sm">View Report →</button>
      </div>
    </div>
  );
}

function PresencePops({ items }: { items: PresencePopItem[] }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 8 }}>
      {items.map((p) => (
        <div key={p.id} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, animation: 'presencePop 2.7s cubic-bezier(.2,.8,.2,1) forwards' }}>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            <span style={{ position: 'absolute', width: 44, height: 44, borderRadius: '50%', border: `2px solid ${p.ring}`, animation: 'ringPulse 1.1s ease-out forwards' }} />
            <Avatar handle={p.handle} hue={p.hue} anon={p.anon} size={40} ring />
            <span style={{ position: 'absolute', bottom: -8, right: -10, fontSize: 20, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }}>{p.emoji}</span>
          </div>
          <div className="mono" style={{ textAlign: 'center', marginTop: 6, fontSize: 9, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' }}>{p.anon ? 'anon' : '@' + p.handle}</div>
        </div>
      ))}
    </div>
  );
}

// Coach "Applied" announcement — streamed (typed) text + background flash
function CoachToast({ msg }: { msg: AnnouncementMsg | null }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!msg) { setShown(''); return undefined; }
    setShown('');
    let i = 0;
    const iv = setInterval(() => { i++; setShown(msg.text.slice(0, i)); if (i >= msg.text.length) clearInterval(iv); }, 20);
    return () => clearInterval(iv);
  }, [msg]);
  if (!msg) return null;
  return (
    <>
      <div key={msg.id + 'f'} className="lr-coach-flash" />
      <div key={msg.id} className="lr-coach-toast">
        <Coach size={34} thinking />
        <div>
          <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--cyan)', fontWeight: 700, marginBottom: 2 }}>{msg.title || 'COACH'}</div>
          <div className="lr-coach-stream">{shown}<span className="lr-coach-caret" /></div>
        </div>
      </div>
    </>
  );
}

export interface ListenRackPageProps {
  mode: ModeId;
  modes: ModeId[];
  identity: Identity;
  access: AccessDto;
  roomControl: RoomControl;
  onModeChange?: (m: ModeId) => void;
  onGrant?: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
  /** When set, the page plays the real uploaded audio for this version (Phase 1
   *  port). When omitted, the page runs the mock rAF transport clock (demo route). */
  versionId?: string;
}

export function ListenRackPage({ mode, modes, identity, access, roomControl, onModeChange, onGrant, versionId }: ListenRackPageProps) {
  // ── Real-audio seam (Phase 1) ──
  // `versionId` present ⇒ real mode: mount <audio> + the page-agnostic audio
  // graph and drive the transport off the element. Absent ⇒ mock demo clock.
  const realAudio = versionId != null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useAudioGraph(audioRef);
  const audioUrl = useMemo(() => {
    if (!versionId) return null;
    const token = getAccessToken();
    if (!token) return null;
    // Dep is [versionId] ONLY — not the token. A silent refresh rotates the token
    // but must not recompute this URL, or <audio src> would change and re-mount
    // the element, resetting currentTime. Mirrors listen.$versionId.tsx.
    return `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}`;
  }, [versionId]);

  // DEV-ONLY smoke harness: expose the rack page's audio-graph handle on window
  // so the engine can be driven from the console (e.g. __spectrRackGraph
  // .ensureContext()). Dead-code-eliminated in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __spectrRackGraph?: typeof graph }).__spectrRackGraph = graph;
  }, [graph]);

  const [playing, setPlaying] = useState(!realAudio);
  const [position, setPosition] = useState(realAudio ? 0 : 42);
  const [duration, setDuration] = useState(realAudio ? 0 : TRACK.durationSec);
  const [director, setDirector] = useState('off');
  const [viz, setViz] = useState<VizState>(DEFAULT_VIZ);
  const [stages, setStages] = useState<string[]>(['eq']);
  const toggleStage = useCallback((id: string) => setStages((s) => s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]), []);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [pops, setPops] = useState<PresencePopItem[]>([]);
  const [feed, setFeed] = useState<ReactionFeedItem[]>([]);
  const [metersOpen, setMetersOpen] = useState(true);
  const [announcement, setAnnouncement] = useState<AnnouncementMsg | null>(null);
  const [myStatus, setMyStatus] = useState('🎧');
  const [bottomView, setBottomView] = useState<'rack' | 'lights'>('rack');
  const [vizPresets, setVizPresets] = useState<VizPreset[]>([]);

  const saveVizPreset = useCallback(() => setVizPresets((p) => [...p, { id: Math.random().toString(36).slice(2), name: 'Look ' + (p.length + 1), viz, stages: [...stages], director }]), [viz, stages, director]);
  const recallVizPreset = useCallback((p: VizPreset) => { setViz(p.viz); setStages([...p.stages]); setDirector(p.director); }, []);
  const randomizeViz = useCallback(() => {
    const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const hues = [165, 280, 30, 210, 320, 100, 50];
    const cs = ['eq', 'devices', 'radial', 'orbit', 'bloom', 'smoke', 'spectro', 'lights'];
    const st: string[] = [];
    const n = 1 + Math.floor(Math.random() * 2);
    while (st.length < n) { const sId = pick(cs); if (!st.includes(sId)) st.push(sId); }
    setStages(st);
    setViz((v) => ({ ...v, barColor: hslToHex(pick(hues)), bg: hslToHex(pick(hues)), laserEffect: pick(LASER_EFFECTS), laserPattern: pick(LASER_PATTERNS), laserMove: Math.random() < 0.5, laserMono: Math.random() < 0.4, laserColor: hslToHex(pick(hues)), bgFlash: Math.random() < 0.4, bgFlashHz: 1 + Math.floor(Math.random() * 5), bgFlashColor: hslToHex(pick(hues)) }));
  }, []);

  const rs = useRackState();

  const directorObj: Director | undefined = useMemo(() => DIRECTORS.find((d) => d.id === director), [director]);
  const activeModules: ModuleManifest[] = useMemo(() => rs.order.filter((id) => rs.mod[id].enabled).map((id) => MANIFEST_BY_ID[id]), [rs.order, rs.mod]);
  const posRef = useRef(position); posRef.current = position;
  const modeRef = useRef(mode); modeRef.current = mode;

  const announce = useCallback((text: string, title?: string) => setAnnouncement({ id: Math.random().toString(36).slice(2), text, title }), []);
  const grantControl = useCallback((scope: 'rack' | 'visuals', actor: ActorRef | null) => {
    onGrant?.(scope, actor);
    const who = actor ? `@${actor.handle ?? actor.displayName ?? 'someone'}` : 'the host';
    announce(`${who} can now control the ${scope === 'rack' ? 'rack' : 'visuals'}`,
      scope === 'rack' ? 'RACK CONTROL' : 'VISUALS CONTROL');
  }, [onGrant, announce]);
  const chooseDirector = useCallback((id: string) => {
    setDirector(id);
    const d = DIRECTORS.find((x) => x.id === id);
    if (d && d.apply && !d.behaviorOnly) setViz((s) => ({ ...s, ...d.apply }));
  }, []);

  // ── Transport clock (MOCK rAF) — demo route only; real mode drives off <audio> ──
  useEffect(() => {
    if (realAudio) return undefined;
    if (!playing) return undefined;
    let raf = 0;
    const start = performance.now();
    const p0 = posRef.current;
    const f = () => {
      const p = p0 + (performance.now() - start) / 1000;
      if (p >= TRACK.durationSec) { setPosition(0); setPlaying(false); return; }
      setPosition(p);
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing, realAudio]);

  // ── Real-audio transport (element-driven). No-op in mock mode (audioRef null). ──
  // Position is tracked off `timeupdate` and duration off `durationchange` /
  // `loadedmetadata`, mirroring listen.$versionId.tsx so a token-refresh re-mount
  // (which can't happen here — see the audioUrl memo) wouldn't jump the playhead.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const onTime = () => setPosition(a.currentTime);
    const onDur = () => { if (Number.isFinite(a.duration)) setDuration(a.duration); };
    const onEnd = () => setPlaying(false);
    const onErr = () => { setPlaying(false); toast.error('Could not load audio. Try refreshing.'); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDur);
    a.addEventListener('durationchange', onDur);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDur);
      a.removeEventListener('durationchange', onDur);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onErr);
    };
  }, [audioUrl]);

  // Per-mode layout defaults (spec §04): Room → full light show + minimal
  // metering; Work/View → rack-first + prominent metering.
  useEffect(() => {
    if (mode === 'room') {
      setBottomView('lights');
      setMetersOpen(false);
      if (director === 'off') chooseDirector('club');
    } else {
      setBottomView('rack');
      setMetersOpen(true);
    }
  }, [mode, director, chooseDirector]);

  const spawnPresence = useCallback((listener: { handle: string; hue: number; anon?: boolean | undefined }, emoji: string) => {
    const id = Math.random().toString(36).slice(2);
    const x = 8 + Math.random() * 80, y = 24 + Math.random() * 46;
    setPops((p) => [...p, { id, handle: listener.handle, hue: listener.hue, anon: listener.anon, emoji, x, y, ring: `oklch(0.72 0.16 ${listener.hue || 168})` }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 2700);
  }, []);
  const spawnReaction = useCallback((emoji: string, handle: string) => {
    const u = ROOM_LISTENERS.find((x) => x.handle === handle) || ROOM_LISTENERS[0];
    spawnPresence(u, emoji);
    setFeed((fd) => [{ id: Math.random().toString(36).slice(2), emoji, handle: u.handle, text: '', t: Math.floor(posRef.current), you: u.you }, ...fd].slice(0, 14));
  }, [spawnPresence]);
  const handleDrop = useCallback(() => {
    if (modeRef.current !== 'room') return;
    ROOM_LISTENERS.filter(() => Math.random() < 0.75).forEach((u, i) => setTimeout(() => spawnPresence(u, '🔥'), i * 130));
  }, [spawnPresence]);

  useEffect(() => {
    if (!playing || mode !== 'room') return undefined;
    const iv = setInterval(() => {
      if (Math.random() < 0.6) {
        const u = ROOM_LISTENERS[1 + Math.floor(Math.random() * (ROOM_LISTENERS.length - 1))];
        spawnReaction(REACTION_EMOJI[Math.floor(Math.random() * REACTION_EMOJI.length)], u.handle);
      }
    }, 2800);
    return () => clearInterval(iv);
  }, [playing, mode, spawnReaction]);

  useEffect(() => { if (!announcement) return undefined; const t = setTimeout(() => setAnnouncement(null), 4800); return () => clearTimeout(t); }, [announcement]);

  // Transport actions. Real mode operates the <audio> element (ensureContext on
  // the gesture BEFORE play(), per the autoplay policy); mock mode toggles the
  // rAF clock. `seek` takes seconds (Transport already converts pct→seconds).
  const togglePlay = useCallback(() => {
    if (!realAudio) { setPlaying((p) => !p); return; }
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) { a.pause(); setPlaying(false); return; }
    try {
      graph.ensureContext();
    } catch (err) {
      toast.error(`Audio engine failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    a.play()
      .then(() => setPlaying(true))
      .catch((err: unknown) => {
        toast.error(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
        setPlaying(false);
      });
  }, [realAudio, graph]);

  const seek = useCallback((t: number) => {
    if (!realAudio) { setPosition(t); return; }
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setPosition(t);
  }, [realAudio]);

  const cap = resolveCapabilities(mode, identity, roomControl, access);
  const rackReadOnly = cap.rackReadOnly;

  return (
    <div className="lr-shell">
      <div className="lr-page">
        <TrackHeader mode={mode} modes={modes} identity={identity} {...(onModeChange ? { onModeChange } : {})} />

        <div className="lr-grid">
          <div style={{ minWidth: 0 }}>
            <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
              <PresencePops items={pops} />
              <VisualMeters track={TRACK} playing={playing} open={metersOpen} setOpen={setMetersOpen} />
              <VizStage playing={playing} stages={stages} setStages={setStages} viz={viz}
                director={directorObj} height={440} onDrop={handleDrop} myStatus={myStatus} activeModules={activeModules} />
              <CoachToast msg={announcement} />
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <Transport track={TRACK} playing={playing} position={position} duration={duration} onTogglePlay={togglePlay}
                  onSeek={seek} notes={TRACK.notes} onNoteClick={(n) => { setActiveNote(n.id); seek(n.t); }} activeNote={activeNote} reactions={feed} />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setBottomView('rack')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'rack' ? '#06151a' : 'var(--muted)', background: bottomView === 'rack' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'rack' ? 'transparent' : 'var(--border)') }}>▦ RACK</button>
                <button type="button" onClick={() => setBottomView('lights')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'lights' ? '#06151a' : 'var(--muted)', background: bottomView === 'lights' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'lights' ? 'transparent' : 'var(--border)') }}>☀ VISUALS</button>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    value=""
                    onChange={(e) => {
                      if (bottomView === 'rack') { const p = rs.presets.find((x) => x.id === e.target.value); if (p) rs.recallPreset(p); }
                      else { const p = vizPresets.find((x) => x.id === e.target.value); if (p) recallVizPreset(p); }
                    }}
                    className="mono" style={{ fontSize: 10, background: 'var(--card-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px' }}
                  >
                    <option value="">Presets ({(bottomView === 'rack' ? rs.presets : vizPresets).length})</option>
                    {(bottomView === 'rack' ? rs.presets : vizPresets).map((p: RackPreset | VizPreset) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => (bottomView === 'rack' ? rs.savePreset(roomControl.rackHolder?.handle || 'you') : saveVizPreset())} className="btn sm primary" style={{ fontSize: 10.5 }}>+ Save preset</button>
                  {(() => {
                    const ac = bottomView === 'rack' ? roomControl.rackHolder : roomControl.visualsHolder;
                    if (!ac) return null;
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.4)' }}>
                        <Avatar handle={ac.handle ?? ac.displayName ?? '?'} hue={ac.hue || 220} anon={ac.type === 'anon'} size={20} />
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--violet)' }}>{bottomView === 'rack' ? 'rack' : 'visuals'} · @{ac.handle ?? ac.displayName ?? '?'}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
              {bottomView === 'rack'
                ? (rackReadOnly
                  ? (
                    <div style={{ position: 'relative' }}>
                      <div style={{ pointerEvents: 'none', opacity: 0.9 }}>
                        <InlineRack rs={rs} playing={playing} controller={roomControl.rackHolder?.handle ?? null} />
                      </div>
                      <div className="mono" style={{ position: 'absolute', top: 12, right: 14, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--violet)', padding: '4px 9px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)' }}>READ-ONLY{cap.canSuggest ? ' · FORK TO SUGGEST' : ''}</div>
                    </div>
                  )
                  : <InlineRack rs={rs} playing={playing} controller={roomControl.rackHolder?.handle ?? null} />)
                : <VisualsPanel stages={stages} toggleStage={toggleStage} director={director} setDirector={chooseDirector} viz={viz} setViz={setViz} onRandomize={randomizeViz} />}
            </div>
          </div>

          <RightRail mode={mode} access={access} cap={cap} rs={rs} track={TRACK} position={position}
            activeNote={activeNote} onNoteClick={(n) => { setActiveNote(n.id); seek(n.t); }} onSeek={seek}
            onReact={(e) => { setMyStatus(e); spawnReaction(e, 'maek'); }} feed={feed} announce={announce} myStatus={myStatus}
            roomControl={roomControl} onGrant={grantControl} />
        </div>
      </div>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />
      )}
    </div>
  );
}
