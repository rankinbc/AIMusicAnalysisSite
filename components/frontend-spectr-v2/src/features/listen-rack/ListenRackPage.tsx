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

import { CoverArt } from '../../ui/CoverArt';
import {
  availableModes, MODE_SURFACE_MATRIX, MOCK_ACCESS, type ModeId,
} from './access';
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

function TrackHeader({ mode, modes, setMode }: { mode: ModeId; modes: ModeId[]; setMode: (m: ModeId) => void }) {
  const t = TRACK;
  const surface = MODE_SURFACE_MATRIX[mode];
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
        <SegBar value={mode} onChange={(id) => setMode(id as ModeId)} options={modes.map((id) => ({ id, label: MODE_SURFACE_MATRIX[id].label }))} accent={surface.accent} />
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

export function ListenRackPage() {
  const access = MOCK_ACCESS;
  const modes = useMemo(() => availableModes(access), [access]);
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(42);
  const [mode, setMode] = useState<ModeId>(modes[0] ?? 'work');
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
  const [rackController, setRackController] = useState<string | null>(null);
  const [visualController, setVisualController] = useState<string | null>(null);
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
  const grantControl = useCallback((h: string, scope: 'rack' | 'visuals') => {
    if (scope === 'visuals') { setVisualController(h); announce(`@${h} can now control the visuals`, 'VISUALS CONTROL'); }
    else { setRackController(h); announce(`@${h} can now control the rack`, 'RACK CONTROL'); }
  }, [announce]);
  const chooseDirector = useCallback((id: string) => {
    setDirector(id);
    const d = DIRECTORS.find((x) => x.id === id);
    if (d && d.apply && !d.behaviorOnly) setViz((s) => ({ ...s, ...d.apply }));
  }, []);

  // ── Transport clock (MOCK rAF) — replace with the real player transport ──
  useEffect(() => {
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
  }, [playing]);

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

  const surface = MODE_SURFACE_MATRIX[mode];
  const rackReadOnly = surface.rack === 'readonly';

  return (
    <div className="lr-shell">
      <div className="lr-page">
        <TrackHeader mode={mode} modes={modes} setMode={setMode} />

        <div className="lr-grid">
          <div style={{ minWidth: 0 }}>
            <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
              <PresencePops items={pops} />
              <VisualMeters track={TRACK} playing={playing} open={metersOpen} setOpen={setMetersOpen} />
              <VizStage playing={playing} stages={stages} setStages={setStages} viz={viz}
                director={directorObj} height={440} onDrop={handleDrop} myStatus={myStatus} activeModules={activeModules} />
              <CoachToast msg={announcement} />
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <Transport track={TRACK} playing={playing} position={position} onTogglePlay={() => setPlaying((p) => !p)}
                  onSeek={setPosition} notes={TRACK.notes} onNoteClick={(n) => { setActiveNote(n.id); setPosition(n.t); }} activeNote={activeNote} reactions={feed} />
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
                  <button type="button" onClick={() => (bottomView === 'rack' ? rs.savePreset(rackController || 'you') : saveVizPreset())} className="btn sm primary" style={{ fontSize: 10.5 }}>+ Save preset</button>
                  {(() => {
                    const ac = bottomView === 'rack' ? rackController : visualController;
                    if (!ac) return null;
                    const u = ROOM_LISTENERS.find((x) => x.handle === ac);
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.4)' }}>
                        <Avatar handle={ac} hue={u?.hue || 220} anon={u?.anon} size={20} />
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--violet)' }}>{bottomView === 'rack' ? 'rack' : 'visuals'} · @{ac}</span>
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
                        <InlineRack rs={rs} playing={playing} controller={rackController} />
                      </div>
                      <div className="mono" style={{ position: 'absolute', top: 12, right: 14, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--violet)', padding: '4px 9px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)' }}>READ-ONLY · FORK TO SUGGEST</div>
                    </div>
                  )
                  : <InlineRack rs={rs} playing={playing} controller={rackController} />)
                : <VisualsPanel stages={stages} toggleStage={toggleStage} director={director} setDirector={chooseDirector} viz={viz} setViz={setViz} onRandomize={randomizeViz} />}
            </div>
          </div>

          <RightRail mode={mode} access={access} rs={rs} track={TRACK} position={position}
            activeNote={activeNote} onNoteClick={(n) => { setActiveNote(n.id); setPosition(n.t); }} onSeek={setPosition}
            onReact={(e) => { setMyStatus(e); spawnReaction(e, 'maek'); }} feed={feed} announce={announce} myStatus={myStatus}
            rackController={rackController} visualController={visualController} onGrant={grantControl} />
        </div>
      </div>
    </div>
  );
}
