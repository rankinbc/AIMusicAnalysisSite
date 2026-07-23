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

import { fetcher, getAccessToken } from '../../api/fetcher';
import { useStemProposals } from '../../api/hooks';
import { useAudioGraph, type AudioFrame } from '../listen/useAudioGraph';
import { createMediaRetry } from '../listen/media-retry';
import { StemDeck, type DeckStem } from '../listen/StemDeck';
import { useStemEngine } from '../listen/useStemEngine';
import { CoverArt } from '../../ui/CoverArt';
import {
  MODE_SURFACE_MATRIX, type AccessDto, type ActorRef, type ModeId,
} from './access';
import { resolveCapabilities } from './capabilities';
import { type Identity, type RoomControl } from './identity';
import {
  DIRECTORS, LASER_EFFECTS, LASER_PATTERNS, MANIFEST_BY_ID, ROOM_LISTENERS, REACTION_EMOJI, TRACK,
  type AnnouncementMsg, type Director, type ModuleManifest, type PresencePopItem,
  type ReactionFeedItem, type Track, type VizState, DEFAULT_VIZ,
} from './data';
import { hslToHex } from './helpers';
import './listenRack.css';
import { InlineRack } from './rackLayouts';
import { pushFullRack } from './rackBindings';
import { RightRail, VisualMeters, VisualsPanel, type ReportRef, type StatsSource } from './rail';
import { useRackState, type RackPreset } from './rackState';
import type { Chain } from './chain';
import type { ModuleState } from './data';
import {
  asChain, buildExportEnvelope, parseImportEnvelope, resolveDraftRestore, useRackDraft,
  useRackDraftAutosave, useRackPreset, useRackPresets, useSaveRackPreset,
} from './useRackPresets';
import { overlayChain } from './fixToRackPatch';
import { clearFixOverlay } from './listenFixes';
import {
  applySuggestionChain, chainFromSnapshot, resolveRackSurface, restoreRack, snapshotRack,
  type RackSnapshot,
} from './suggest-draft';
import { SuggestModeChip } from './SuggestModeChip';
import { useCreateSuggestion } from '../listen/useSuggestions';
import type { SuggestionAuditionSeam } from '../listen/SuggestionCard';
import type { SuggestionDto } from '../../api/types';
import { Link, useNavigate } from '@tanstack/react-router';
import { VersionShareDialog } from '../listen/VersionShareDialog';
import type { RoomLiveSeam } from './useRoomOrchestration';
import { actorKey } from './roomStateReducer';
import { reactOutcome, roomHeaderState } from './roomUiState';
import { planTransportEmit, planTransportFollow } from './transportSync';
import { asVizLook, useSaveVizPreset, useVizPresets } from './useVizPresetsServer';
import { Transport } from './transport';
import { BookmarksRail } from '../listen/BookmarksRail';
import { Coach } from '../../ui/Coach';
import { Avatar, SegBar } from './ui';
import { VizStage } from './viz';

interface VizPreset { id: string; name: string; viz: VizState; stages: string[]; director: string }

// Locked-transport stand-in (guests following the host): assignable to both
// () => void and (t: number) => void handler slots.
const noopHandler = () => undefined;

// Exported for the 12.4 chip render test (all-modes assertion).
export function TrackHeader({ track, mode, modes, onModeChange, fixesApplied, onResetFixes, reportRef, onShare }: {
  track: Track; mode: ModeId; modes: ModeId[]; identity: Identity; onModeChange?: (m: ModeId) => void;
  /** Story 12.4: carried-fix chip — renders in EVERY mode (this header is the
   *  page's only all-modes surface). null = no carry active. */
  fixesApplied?: number | null; onResetFixes?: () => void;
  /** Wave-3 E6.5 — the song's latest report. Set ⇒ "View Report →" is a real
   *  link; null/absent ⇒ no button (never a dead one). */
  reportRef?: ReportRef | null;
  /** Wave-3 E7.1 — owner-only share/invite dialog opener (real-audio route). */
  onShare?: () => void;
}) {
  const t = track;
  const surface = MODE_SURFACE_MATRIX[mode];
  // Anyone with >1 available mode may switch (room-completion PRP: joinable
  // guests need VIEW↔ROOM). The orchestration constrains switches to `modes`.
  const showSwitcher = onModeChange && modes.length > 1;
  return (
    <div className="lr-head">
      <CoverArt hue={168} size="md" />
      <div className="lr-head-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', letterSpacing: '0.14em' }}>NOW PLAYING</span>
          <span className="dot" style={{ animation: 'pulseGlow 1.6s ease-in-out infinite' }} />
          {fixesApplied != null && fixesApplied > 0 && (
            <span className="pill cyan" data-testid="fixes-applied-chip">
              Fixes applied: {fixesApplied}
              {onResetFixes && (
                <button
                  type="button"
                  onClick={onResetFixes}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: 0, marginLeft: 6, textDecoration: 'underline' }}
                >
                  reset
                </button>
              )}
            </span>
          )}
        </div>
        <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.015em', margin: '0 0 3px' }}>{t.name}</h1>
        {t.author && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <Avatar handle={t.author} hue={168} size={20} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>by {t.author}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{t.handle}</span>
          </div>
        )}
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
        {onShare && (
          <button type="button" className="btn sm" onClick={onShare}>Share</button>
        )}
        {reportRef && (
          <Link
            to="/songs/$songId/results/$jobId"
            params={{ songId: reportRef.songId, jobId: reportRef.jobId }}
            className="btn primary sm"
          >
            View Report →
          </Link>
        )}
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
  /** Real track header/notes/sections/stats (Phase 2.5). Defaults to the TRACK
   *  fixture for the mock demo route. */
  track?: Track;
  /** Story 11.5 — live SSE room seam. When set, Room mode uses the real
   *  session feed + senders instead of the local mock simulation. */
  roomLive?: RoomLiveSeam | null;
  /** Story 11.5 — host-only "go live" affordance (undefined when not hostable
   *  or a session already runs). */
  onStartRoom?: (() => void) | undefined;
  /** E6.8 — start-room pending state (label + disable on the Start button). */
  isStartingRoom?: boolean;
  /** Story 12.4 — the fix-rack carry-over preset id (?fixPreset=). When set,
   *  the page fetches that preset and overlays its chain onto the live rack
   *  once (skipping the draft restore); the "Fixes applied" chip appears. */
  fixPreset?: string;
  /** Wave-3 E6.5 — the song's latest report ({songId, jobId}); null/absent
   *  hides "View Report" and the coach hand-off link. */
  reportRef?: ReportRef | null;
  /** Wave-3 E6.3 — which analysis feeds the Stats rail (mismatch labeling). */
  statsSource?: StatsSource | null;
}

export function ListenRackPage({ mode, modes, identity, access, roomControl, onModeChange, onGrant, versionId, track: trackProp, roomLive, onStartRoom, isStartingRoom = false, fixPreset, reportRef = null, statsSource = null }: ListenRackPageProps) {
  const track = trackProp ?? TRACK;
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
  const [duration, setDuration] = useState(realAudio ? 0 : track.durationSec);
  const [director, setDirector] = useState('off');
  const [viz, setViz] = useState<VizState>(DEFAULT_VIZ);
  const [stages, setStages] = useState<string[]>(['eq']);
  const toggleStage = useCallback((id: string) => setStages((s) => s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]), []);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [pops, setPops] = useState<PresencePopItem[]>([]);
  const [feed, setFeed] = useState<ReactionFeedItem[]>([]);
  const [metersOpen, setMetersOpen] = useState(true);
  // Real meter frame (Phase 2 Task 2): last AnalyserNode snapshot, throttled to
  // ~12 Hz so the rail doesn't reconcile at the 60fps draw cadence. null until
  // the first real frame (and always null on the mock route).
  const [meterFrame, setMeterFrame] = useState<AudioFrame | null>(null);
  const lastMeterTsRef = useRef(0);
  const [announcement, setAnnouncement] = useState<AnnouncementMsg | null>(null);
  const [myStatus, setMyStatus] = useState('🎧');
  const [bottomView, setBottomView] = useState<'rack' | 'lights' | 'stems'>('rack');
  const [vizPresets, setVizPresets] = useState<VizPreset[]>([]);
  // Wave-3 E7.1 — owner share/invite dialog (real-audio route only).
  const [shareOpen, setShareOpen] = useState(false);

  const saveVizPreset = useCallback(() => setVizPresets((p) => [...p, { id: Math.random().toString(36).slice(2), name: 'Look ' + (p.length + 1), viz, stages: [...stages], director }]), [viz, stages, director]);
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

  const rs = useRackState(realAudio ? graph : null);
  // Latest rack snapshot for the first-play full sync (avoids putting the
  // render-fresh `rs` object in togglePlay's deps).
  const rsRef = useRef(rs);
  rsRef.current = rs;

  // ── Server-backed rack presets + draft + viz looks (PRP-1) ─────────────────
  // Version-scoped on the real-audio route; the mock demo route stays in-memory
  // (rs.presets / vizPresets). The live chain is the snapshot we save + autosave.
  const currentChain = useMemo<Chain>(
    () => ({ order: rs.order, modules: rs.mod, masterBypass: rs.masterBypass }),
    [rs.order, rs.mod, rs.masterBypass],
  );

  // ── Story 11.12: fork-to-suggest + audition STATE (handlers live below the
  // draft block). Declared up here because the draft autosave gate must see it:
  // fork edits and auditioned chains are transient rack states, never the
  // user's draft (review CRITICAL — an owner auditioning a suggestion would
  // otherwise have it autosaved over their real draft 1.2 s later, and a
  // non-owner reviewer's fork edits would spam failing PUTs).
  const [suggesting, setSuggesting] = useState(false);
  const [abSide, setAbSide] = useState<'draft' | 'original'>('draft');
  const forkSnapshotRef = useRef<RackSnapshot | null>(null);
  const draftHoldRef = useRef<RackSnapshot | null>(null);
  const [auditioningId, setAuditioningId] = useState<string | null>(null);
  const auditionSnapshotRef = useRef<RackSnapshot | null>(null);

  const { data: rackPresetDtos } = useRackPresets(realAudio ? (versionId ?? '') : '');
  const saveRackPresetMut = useSaveRackPreset(versionId ?? '');
  const serverRackPresets = useMemo<RackPreset[]>(() => (rackPresetDtos ?? []).flatMap((d) => {
    const chain = asChain(d.chain);
    if (!chain) return [];
    return [{
      id: d.id, name: d.name, by: d.source, order: chain.order,
      mod: chain.modules as Record<string, ModuleState>,
      n: Object.values(chain.modules).filter((s) => s?.enabled).length,
    }];
  }), [rackPresetDtos]);

  const { data: vizPresetDtos } = useVizPresets();
  const saveVizMut = useSaveVizPreset();
  const serverVizPresets = useMemo<VizPreset[]>(() => (vizPresetDtos ?? []).flatMap((d) => {
    const look = asVizLook(d.viz);
    if (!look) return [];
    return [{ id: d.id, name: d.name, viz: look.viz, stages: look.stages, director: look.director }];
  }), [vizPresetDtos]);

  // ── Story 12.4: fix-rack carry-over (?fixPreset=) ──────────────────────────
  // Read-only surfaces (View / Room guest) never receive a carried chain.
  // Carry eligibility is LATCHED per fixPreset value (review: a mid-flight mode
  // switch or SSE rack-control revoke must not strand the page with neither
  // draft nor carry applied — the arrival-time decision holds).
  const carryAllowedNow = Boolean(
    fixPreset && realAudio && !resolveCapabilities(mode, identity, roomControl, access).rackReadOnly,
  );
  const carryArmedRef = useRef<boolean | null>(null);
  if (carryArmedRef.current === null) carryArmedRef.current = carryAllowedNow;
  const carryArmed = Boolean(fixPreset) && carryArmedRef.current === true;
  const carriedPresetQuery = useRackPreset(
    realAudio ? (versionId ?? '') : '', carryArmed ? fixPreset : undefined);
  // null = no carry active; number = modules the carried chain enabled.
  const [fixesApplied, setFixesApplied] = useState<number | null>(null);
  // 'pending' while a carry is armed and unresolved; 'applied' | 'failed' settle
  // it. The draft machinery WAITS for settlement so a slow/failed carry can
  // never let autosave clobber the saved draft with defaults (review HIGH).
  const [carryPhase, setCarryPhase] = useState<'none' | 'pending' | 'applied' | 'failed'>(
    carryArmed ? 'pending' : 'none');
  const appliedPresetRef = useRef<string | null>(null); // one-shot per preset id
  const navigate = useNavigate();

  // A NEW fixPreset value on the mounted route (back-nav restoring the param,
  // clicking "Open in Listen rack" again after a reset) re-arms the carry.
  useEffect(() => {
    if (!fixPreset || appliedPresetRef.current === fixPreset) return;
    carryArmedRef.current = carryAllowedNow;
    if (carryArmedRef.current) setCarryPhase('pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm keys on the param only
  }, [fixPreset]);

  // Autosaved draft: restore once when it resolves, then enable debounced autosave.
  // Gating autosave on `draftRestored` prevents a default-chain autosave from
  // clobbering the persisted draft before the GET returns.
  // Story 12.4: while a carry is PENDING neither restore nor autosave runs. A
  // successful carry skips the restore (carry wins; autosave then persists the
  // carried chain as the new draft). A FAILED carry falls back to the normal
  // draft restore — the saved draft is never sacrificed to a 404.
  const draftQuery = useRackDraft(realAudio ? (versionId ?? '') : '');
  // Destructured so the effect deps are stable fields, not the query object
  // (whose identity changes every render).
  const {
    isError: draftIsError, isFetched: draftIsFetched, data: draftData,
    refetch: refetchDraft,
  } = draftQuery;
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    // E6.6: the branch ORDER lives in resolveDraftRestore — carry gates, then
    // the GET-error pause (draftRestored stays false ⇒ autosave stays OFF, so
    // a transient failure can never let defaults clobber the saved draft),
    // then the settled-fetch restore. Retry refetches, which resets the query
    // error state and re-drives this effect via the deps below.
    const decision = resolveDraftRestore({
      draftRestored, realAudio, carryPhase,
      isError: draftIsError, isFetched: draftIsFetched,
    });
    if (decision === 'wait') return;
    if (decision === 'pause') {
      toast.error("Couldn't load your saved rack draft — autosave is paused.", {
        id: 'rack-draft-load', // dedupe: replace, never stack
        action: { label: 'Retry', onClick: () => { void refetchDraft(); } },
      });
      return;
    }
    if (decision === 'restore') {
      const chain = draftData ? asChain(draftData.chain) : null;
      if (chain) {
        rsRef.current.recallPreset({
          id: 'draft', name: 'draft', by: 'you', order: chain.order,
          mod: chain.modules as Record<string, ModuleState>, n: 0,
        });
        rsRef.current.setMasterBypass(chain.masterBypass);
      }
    }
    setDraftRestored(true); // 'arm' (carry applied) and 'restore' both arm autosave
  }, [draftRestored, realAudio, carryPhase, draftIsError, draftIsFetched, draftData,
    refetchDraft]);
  // 11.12: autosave is OFF while forked or auditioning — those are transient
  // rack states (the fork draft belongs to the suggestion; the audition chain
  // belongs to the proposer), never the user's persisted draft.
  useRackDraftAutosave(versionId ?? '', currentChain,
    realAudio && draftRestored && !suggesting && auditioningId == null);

  // Apply the carried chain ONCE per preset id when it resolves: overlay onto
  // the live module map (manual knobs on modules the chain doesn't enable
  // survive; pitch never written). React state is enough for "after the graph
  // is ready" — live pushes no-op until ensureContext(), and the first-play
  // togglePlay pushFullRack syncs from rsRef.
  useEffect(() => {
    if (!carryArmed || !fixPreset || appliedPresetRef.current === fixPreset) return;
    if (carriedPresetQuery.isError) {
      appliedPresetRef.current = fixPreset;
      setCarryPhase('failed');
      toast.error('Could not load the carried fix rack — your saved draft is untouched.');
      return;
    }
    const dto = carriedPresetQuery.data;
    if (!dto) return; // still loading
    const chain = asChain(dto.chain);
    // Count what the overlay will actually APPLY: enabled, non-pitch modules.
    const applied = chain
      ? Object.entries(chain.modules).filter(([id, m]) => id !== 'pitch' && m?.enabled).length
      : 0;
    appliedPresetRef.current = fixPreset;
    if (!chain || applied === 0) {
      // Malformed or empty chain: never half-apply (a bare masterBypass with
      // no chip would silently mute the rack with no affordance to undo).
      setCarryPhase('failed');
      toast.error('The carried fix rack could not be applied.');
      return;
    }
    rsRef.current.applyRackMod(overlayChain(rsRef.current.mod, chain.modules));
    rsRef.current.setMasterBypass(chain.masterBypass);
    setFixesApplied(applied);
    setCarryPhase('applied');
  }, [carryArmed, fixPreset, carriedPresetQuery.isError, carriedPresetQuery.data]);

  // Chip reset: restore neutral rack, clear the URL param (so refresh doesn't
  // re-apply), and clear the Plan-tab overlay (through the hook's event seam so
  // a mounted PlanPanel's checkboxes/baseline reset too — not just localStorage).
  const onResetCarriedFixes = useCallback(() => {
    rsRef.current.reset();
    if (versionId) clearFixOverlay(versionId);
    setFixesApplied(null);
    setCarryPhase('none');
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId: versionId ?? '' },
      // Omit-by-destructure: exactOptionalPropertyTypes forbids an explicit
      // `fixPreset: undefined`; other (future) search params survive.
      search: (prev: Record<string, unknown>) => {
        const rest = { ...prev };
        delete rest['fixPreset'];
        return rest;
      },
      replace: true,
    });
  }, [versionId, navigate]);

  // ── Story 11.12: fork-to-suggest + suggestion audition HANDLERS ────────────
  // Fork = page-local state that lifts the View-mode read-only overlay and lets
  // the reviewer edit the LIVE rack (so the draft is audible). Everything is
  // snapshot/restore over `rs` — every capture is a deep clone (`rs.mod` is a
  // live mutable map; a shallow ref would alias the state being edited and turn
  // restore into a no-op). No server write until Submit. (State declared above
  // the draft block — the autosave gate reads it.)
  const createSuggestionMut = useCreateSuggestion(versionId ?? '');
  // The saved-draft restore (and a pending 12-4 carry) must settle before any
  // snapshot is taken — otherwise fork/audition captures the default chain and
  // the late restore stomps the live fork (review finding). Ref'd so the
  // stable callbacks read the live value.
  const rackSettled = !realAudio || draftRestored;
  const rackSettledRef = useRef(rackSettled);
  rackSettledRef.current = rackSettled;

  const startSuggesting = useCallback(() => {
    if (forkSnapshotRef.current || !rackSettledRef.current) return;
    // Auditioning + forking never overlap — revert any active audition first so
    // the fork snapshot captures the reviewer's real baseline, not a preview.
    if (auditionSnapshotRef.current) {
      restoreRack(rsRef.current, auditionSnapshotRef.current);
      auditionSnapshotRef.current = null;
      setAuditioningId(null);
    }
    forkSnapshotRef.current = snapshotRack(rsRef.current);
    draftHoldRef.current = null;
    setAbSide('draft');
    setSuggesting(true);
  }, []);

  const endSuggesting = useCallback((restore: boolean) => {
    if (restore && forkSnapshotRef.current) restoreRack(rsRef.current, forkSnapshotRef.current);
    forkSnapshotRef.current = null;
    draftHoldRef.current = null;
    setAbSide('draft');
    setSuggesting(false);
  }, []);

  const toggleAbSide = useCallback(() => {
    const snap = forkSnapshotRef.current;
    if (!snap) return;
    if (abSide === 'draft') {
      draftHoldRef.current = snapshotRack(rsRef.current);
      restoreRack(rsRef.current, snap);
      setAbSide('original');
    } else {
      if (draftHoldRef.current) restoreRack(rsRef.current, draftHoldRef.current);
      draftHoldRef.current = null;
      setAbSide('draft');
    }
  }, [abSide]);

  const submitSuggestion = useCallback(() => {
    if (!versionId || createSuggestionMut.isPending) return;
    // The draft is what's live — unless the reviewer is on the A (original)
    // side, where the draft is parked in draftHold. Submit ALWAYS posts the draft.
    const draft = abSide === 'original' && draftHoldRef.current
      ? draftHoldRef.current
      : snapshotRack(rsRef.current);
    createSuggestionMut.mutate({ chain: chainFromSnapshot(draft) }, {
      onSuccess: () => {
        endSuggesting(true);
        toast.success('Suggestion sent to the owner.');
      },
      onError: (err: unknown) => {
        // Stay forked — the reviewer's draft must survive a failed POST.
        toast.error(err instanceof Error && err.message ? err.message : 'Could not send the suggestion.');
      },
    });
  }, [versionId, abSide, createSuggestionMut, endSuggesting]);

  const onRevertAudition = useCallback(() => {
    if (auditionSnapshotRef.current) restoreRack(rsRef.current, auditionSnapshotRef.current);
    auditionSnapshotRef.current = null;
    setAuditioningId(null);
  }, []);

  // Leaving View mode — or navigating to a different version without an
  // unmount — exits fork-to-suggest AND reverts any active audition. Without
  // the audition leg, an owner auditioning in View then switching to Work
  // would silently keep the reviewer's chain as their live rack with the
  // Revert affordance unreachable (review CRITICAL).
  useEffect(() => {
    if (mode !== 'view') {
      if (forkSnapshotRef.current) endSuggesting(true);
      if (auditionSnapshotRef.current) onRevertAudition();
    }
  }, [mode, endSuggesting, onRevertAudition]);
  useEffect(() => () => {
    // versionId changed (or unmount): drop cross-version state. No restore —
    // the rack about to render belongs to the NEW version (restoring would
    // paint track A's chain onto track B).
    forkSnapshotRef.current = null;
    draftHoldRef.current = null;
    auditionSnapshotRef.current = null;
    setSuggesting(false);
    setAbSide('draft');
    setAuditioningId(null);
  }, [versionId]);

  // Audition: apply a suggestion's chain via rs (state + graph stay in sync),
  // one at a time. The FIRST audition takes the snapshot; switching suggestions
  // re-applies from that original snapshot — never from an auditioned state.
  const onAuditionSuggestion = useCallback((sg: SuggestionDto) => {
    if (forkSnapshotRef.current || !rackSettledRef.current) return; // forked (button disabled) or draft not settled
    const base = auditionSnapshotRef.current ?? snapshotRack(rsRef.current);
    if (!applySuggestionChain(rsRef.current, base, sg.chain)) {
      toast.error('This suggestion’s chain could not be applied.');
      return;
    }
    auditionSnapshotRef.current = base;
    setAuditioningId(sg.id);
  }, []);
  const auditionSeam: SuggestionAuditionSeam | null = realAudio ? {
    activeId: auditioningId,
    onAudition: onAuditionSuggestion,
    onRevert: onRevertAudition,
    disabled: suggesting,
  } : null;

  // Unified preset/look handlers — server on the real route, in-memory on mock.
  const onSaveRackPreset = useCallback(() => {
    if (realAudio) {
      saveRackPresetMut.mutate({ name: `Preset ${serverRackPresets.length + 1}`, chain: currentChain });
    } else {
      rs.savePreset(roomControl.rackHolder?.handle || 'you');
    }
  }, [realAudio, saveRackPresetMut, serverRackPresets.length, currentChain, rs, roomControl.rackHolder]);
  const onRecallRackPreset = useCallback((id: string) => {
    if (realAudio) {
      const dto = rackPresetDtos?.find((x) => x.id === id);
      const chain = dto ? asChain(dto.chain) : null;
      if (!dto || !chain) return;
      rs.recallPreset({
        id: dto.id, name: dto.name, by: dto.source, order: chain.order,
        mod: chain.modules as Record<string, ModuleState>, n: 0,
      });
      rs.setMasterBypass(chain.masterBypass); // recallPreset alone keeps current bypass
    } else {
      const p = rs.presets.find((x) => x.id === id);
      if (p) rs.recallPreset(p);
    }
  }, [realAudio, rackPresetDtos, rs]);

  const onSaveVizLook = useCallback(() => {
    if (realAudio) {
      saveVizMut.mutate({ name: `Look ${serverVizPresets.length + 1}`, viz: { viz, stages, director } });
    } else {
      saveVizPreset();
    }
  }, [realAudio, saveVizMut, serverVizPresets.length, viz, stages, director, saveVizPreset]);
  const onRecallVizLook = useCallback((id: string) => {
    const p = (realAudio ? serverVizPresets : vizPresets).find((x) => x.id === id);
    if (!p) return;
    setViz(p.viz); setStages([...p.stages]); setDirector(p.director);
  }, [realAudio, serverVizPresets, vizPresets]);
  const rackPresetItems = realAudio ? serverRackPresets : rs.presets;
  const vizPresetItems = realAudio ? serverVizPresets : vizPresets;

  // JSON export/import — the portability path (no server copy). Export downloads
  // an envelope; import parses + validates it and saves onto THIS owned version.
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const onExportPreset = useCallback(() => {
    const envelope = buildExportEnvelope(`Preset ${rackPresetItems.length + 1}`, currentChain);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rack-preset.json'; a.click();
    URL.revokeObjectURL(url);
  }, [rackPresetItems.length, currentChain]);
  const onImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const { name, chain } = parseImportEnvelope(await file.text());
      saveRackPresetMut.mutate(
        { name, chain },
        { onSuccess: () => toast.success(`Imported "${name}".`) },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    }
  }, [saveRackPresetMut]);

  // ── Pitch lane (Phase 2.5): a separate buffer lane (NOT an insert), driven off
  // the rack's pitch module. pitchModeRef = imperative flag for togglePlay/seek;
  // pitchActive = reactive flag so effects re-run after the async decode resolves.
  // Real mode only; mirrors listen.$versionId.tsx (pitch + tempo are coupled). ──
  const pitchModeRef = useRef(false);
  const [pitchActive, setPitchActive] = useState(false);
  const pitchEnabled = realAudio && !!rs.mod.pitch.enabled;
  const pitchSemitones = Number(rs.mod.pitch.semitones) || 0;
  const pitchCents = Number(rs.mod.pitch.cents) || 0;

  // ── Stem deck (Phase 2.5 parity): real per-stem audio via the stems pipeline,
  // mutually exclusive with the single-track graph. Real mode only; ported from
  // listen.$versionId.tsx. ──
  const { data: stemProposals, isLoading: stemsLoading } = useStemProposals(versionId ?? '', realAudio);
  const deckStems = useMemo<DeckStem[]>(
    () => (stemProposals?.stems ?? []).map((st) => ({
      id: st.id,
      role: st.confirmedRole ?? st.detectedRole ?? null,
      filename: st.originalFilename,
    })),
    [stemProposals],
  );
  const stemEngine = useStemEngine(() => graph.ensureContext());
  const [stemPlaying, setStemPlaying] = useState(false);
  const stemUrl = useCallback(
    (stemId: string) =>
      `/api/versions/${versionId}/stems/${stemId}/audio?t=${encodeURIComponent(getAccessToken() ?? '')}`,
    [versionId],
  );
  // Entering stem mode pauses the single-track lanes (MediaElement + pitch).
  const activateStemMode = useCallback(() => {
    if (pitchModeRef.current && graph.pitchPlaying()) graph.pitchPause();
    const a = audioRef.current;
    if (a && !a.paused) a.pause();
    setPlaying(false);
  }, [graph]);
  // Reverse exclusivity: starting the single-track audio stops the stem deck.
  const stopStems = useCallback(() => {
    setStemPlaying((prev) => { if (prev) stemEngine.pause(); return false; });
  }, [stemEngine]);

  // Story 5.10 review (UX-DR45): the <1024 swap is display-only — display:none
  // does NOT stop audio. Crossing below the lg breakpoint pauses every lane
  // (media element, pitch buffer, stem deck) so the "Desktop tool" notice is
  // never a curtain over invisible playback.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const pauseAll = () => {
      if (!mq.matches) return;
      if (pitchModeRef.current && graph.pitchPlaying()) graph.pitchPause();
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
      setPlaying(false);
      setStemPlaying((prev) => { if (prev) stemEngine.pause(); return false; });
    };
    pauseAll(); // page opened already-narrow (mock mode autoplays)
    mq.addEventListener('change', pauseAll);
    return () => mq.removeEventListener('change', pauseAll);
  }, [graph, stemEngine]);

  const directorObj: Director | undefined = useMemo(() => DIRECTORS.find((d) => d.id === director), [director]);
  const activeModules: ModuleManifest[] = useMemo(() => rs.order.filter((id) => rs.mod[id].enabled).map((id) => MANIFEST_BY_ID[id]), [rs.order, rs.mod]);
  const posRef = useRef(position); posRef.current = position;
  const modeRef = useRef(mode); modeRef.current = mode;
  // E6.11 — live-value refs so the transport emit/follow callbacks stay stable.
  const playingRef = useRef(playing); playingRef.current = playing;
  const roomLiveRef = useRef(roomLive); roomLiveRef.current = roomLive;
  const isHostRef = useRef(identity.isHost); isHostRef.current = identity.isHost;
  const meActorKey = useMemo(() => actorKey(identity.actor), [identity.actor]);
  // Autoplay-policy affordance: a follow-side play() rejected without a prior
  // user gesture — render "▶ Tap to join playback" until a real click succeeds.
  const [needsGesture, setNeedsGesture] = useState(false);

  // ── E6.11 host transport emit: play/pause post immediately, seeks ride a
  // trailing throttle (latest scrub position wins). Fire-and-forget — the
  // stream echo is the ack; sendTransport never rejects (folds session_ended).
  const seekEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const emitTransport = useCallback((kind: 'play' | 'pause' | 'seek', pos: number) => {
    const rl = roomLiveRef.current;
    if (!rl || !isHostRef.current) return;
    const plan = planTransportEmit(kind);
    if (plan.immediate) {
      void rl.sendTransport(kind === 'play', pos);
      return;
    }
    pendingSeekRef.current = pos;
    if (seekEmitTimerRef.current !== null) return; // trailing: one timer, latest value
    seekEmitTimerRef.current = setTimeout(() => {
      seekEmitTimerRef.current = null;
      const latest = pendingSeekRef.current;
      pendingSeekRef.current = null;
      const live = roomLiveRef.current;
      if (live && latest !== null) void live.sendTransport(playingRef.current, latest);
    }, plan.delayMs);
  }, []);
  useEffect(() => () => {
    if (seekEmitTimerRef.current !== null) clearTimeout(seekEmitTimerRef.current);
  }, []);

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
      if (p >= track.durationSec) { setPosition(0); setPlaying(false); return; }
      setPosition(p);
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing, realAudio, track]);

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
    // Story 3.3 (AC4): a resumed session after the presigned URL expired
    // surfaces here — re-request the API URL with a fresh token (the server
    // mints a fresh presign) and restore position. After a long idle BOTH the
    // presign AND the access token are expired, so getSrc first forces a
    // silent refresh via a cheap authed call (fetcher owns 401→refresh→retry).
    // Toast only when the retry itself is refused (cap/guard = real failure).
    const retry = createMediaRetry({
      getSrc: async () => {
        try { await fetcher<unknown>({ url: '/auth/me', method: 'GET' }); } catch { /* give up below */ }
        const token = getAccessToken();
        return versionId && token
          ? `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}`
          : null;
      },
      onGiveUp: () => { setPlaying(false); toast.error('Could not load audio. Try refreshing.'); },
      onResumeBlocked: () => setPlaying(false),
    });
    const onErr = () => {
      void retry.handleError(a).then((retried) => { if (!retried) setPlaying(false); });
    };
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
      retry.dispose(); // disarm any pending restore — it must not replay onto a future src
    };
    // versionId feeds the AC4 retry's getSrc; audioUrl already derives from it.
  }, [audioUrl, versionId]);

  // ── Real meter loop (Phase 2 Task 2). rAF reads the post-rack AnalyserNode and
  // publishes a throttled frame to the meter rail. Real mode + playing only. ──
  useEffect(() => {
    if (!realAudio || !playing) return undefined;
    let raf = 0;
    const draw = () => {
      const nowMs = performance.now();
      if (nowMs - lastMeterTsRef.current >= 80) {
        lastMeterTsRef.current = nowMs;
        setMeterFrame(graph.readFrame());
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [realAudio, playing, graph]);

  // Apply detune to the live BufferSource: on enter (pitchActive flips true) and
  // whenever semitones/cents change while active.
  useEffect(() => {
    if (pitchActive) graph.setPitchDetune(pitchSemitones, pitchCents);
  }, [pitchSemitones, pitchCents, pitchActive, graph]);

  // Enter/exit the pitch buffer lane on the rack's pitch toggle. Decoding the
  // whole file can take a few seconds on long FLACs.
  useEffect(() => {
    let cancelled = false;
    const a = audioRef.current;
    if (!realAudio || !a || !audioUrl) return undefined;
    if (pitchEnabled && !pitchModeRef.current) {
      const wasPlaying = !a.paused;
      const startedAt = a.currentTime;
      a.pause();
      setPlaying(false);
      try {
        graph.ensureContext();
      } catch (err) {
        toast.error(`Audio engine failed: ${err instanceof Error ? err.message : String(err)}`);
        rs.setEnabled('pitch', false);
        return undefined;
      }
      graph
        .enterPitchMode(audioUrl, startedAt)
        .then(() => {
          if (cancelled) return;
          pitchModeRef.current = true;
          setPitchActive(true);
          const bufDur = graph.pitchDuration();
          if (bufDur > 0) setDuration(bufDur);
          setPosition(startedAt);
          if (wasPlaying) { graph.pitchResume(); setPlaying(true); }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          toast.error(`Pitch decode failed: ${err instanceof Error ? err.message : String(err)}`);
          rs.setEnabled('pitch', false);
        });
    } else if (!pitchEnabled && pitchModeRef.current) {
      const wasPlaying = graph.pitchPlaying();
      const pos = graph.exitPitchMode();
      pitchModeRef.current = false;
      setPitchActive(false);
      a.currentTime = pos;
      setPosition(pos);
      if (wasPlaying) {
        a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    }
    return () => { cancelled = true; };
    // semitones/cents are intentionally excluded — the detune effect owns those;
    // re-running here on every knob turn would re-enter pitch mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchEnabled, audioUrl, realAudio, graph]);

  // Position tick in pitch mode (the BufferSource emits no timeupdate).
  useEffect(() => {
    if (!pitchActive) return undefined;
    let raf = 0;
    const tick = () => { setPosition(graph.pitchCurrentTime()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pitchActive, graph]);

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

  // Ambient MOCK reactions — demo only; a live session's feed comes from the
  // SSE stream (story 11.5), so the simulation stays off when roomLive is set.
  useEffect(() => {
    if (!playing || mode !== 'room' || roomLive) return undefined;
    const iv = setInterval(() => {
      if (Math.random() < 0.6) {
        const u = ROOM_LISTENERS[1 + Math.floor(Math.random() * (ROOM_LISTENERS.length - 1))];
        spawnReaction(REACTION_EMOJI[Math.floor(Math.random() * REACTION_EMOJI.length)], u.handle);
      }
    }, 2800);
    return () => clearInterval(iv);
  }, [playing, mode, spawnReaction, roomLive]);

  useEffect(() => { if (!announcement) return undefined; const t = setTimeout(() => setAnnouncement(null), 4800); return () => clearTimeout(t); }, [announcement]);

  // Shared play internals — used by togglePlay AND the listener follow /
  // tap-to-join paths (E6.11), so every play goes through ensureContext + the
  // full-rack sync. May THROW synchronously (engine init) and the returned
  // promise may reject (autoplay policy) — callers pick the copy/affordance.
  const startPlayback = useCallback((): Promise<void> => {
    const a = audioRef.current;
    if (!a) return Promise.resolve();
    stopStems();
    graph.ensureContext();
    // Now that the AudioContext + nodes exist, sync the full rack so any knob
    // moved (or preset recalled) while paused is reflected before audio starts.
    pushFullRack(graph, rsRef.current.mod, rsRef.current.order, rsRef.current.masterBypass);
    return a.play().then(() => setPlaying(true));
  }, [graph, stopStems]);

  // Transport actions. Real mode operates the <audio> element (ensureContext on
  // the gesture BEFORE play(), per the autoplay policy); mock mode toggles the
  // rAF clock. `seek` takes seconds (Transport already converts pct→seconds).
  const togglePlay = useCallback(() => {
    if (!realAudio) { setPlaying((p) => !p); return; }
    const a = audioRef.current;
    if (!a) return;
    // Pitch mode operates the BufferSource lane, not the <audio> element.
    if (pitchModeRef.current) {
      if (graph.pitchPlaying()) {
        graph.pitchPause();
        setPlaying(false);
        emitTransport('pause', posRef.current);
      } else {
        try {
          graph.ensureContext();
        } catch (err) {
          toast.error(`Audio engine failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        stopStems();
        graph.pitchResume();
        setPlaying(true);
        emitTransport('play', posRef.current);
      }
      return;
    }
    if (!a.paused) { a.pause(); setPlaying(false); emitTransport('pause', a.currentTime); return; }
    let played: Promise<void>;
    try {
      played = startPlayback();
    } catch (err) {
      toast.error(`Audio engine failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    played
      .then(() => emitTransport('play', a.currentTime))
      .catch((err: unknown) => {
        toast.error(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
        setPlaying(false);
      });
  }, [realAudio, graph, stopStems, startPlayback, emitTransport]);

  const seek = useCallback((t: number) => {
    if (!realAudio) { setPosition(t); return; }
    if (pitchModeRef.current) { graph.pitchSeek(t); setPosition(t); emitTransport('seek', t); return; }
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setPosition(t);
    emitTransport('seek', t);
  }, [realAudio, graph, emitTransport]);

  const cap = resolveCapabilities(mode, identity, roomControl, access);
  const rackReadOnly = cap.rackReadOnly;

  // E6.11 — guest transport lockout: while the room lives and this client
  // follows the host, local transport handlers no-op (Transport has no
  // disabled prop; the room header shows FOLLOWING HOST). An ended room
  // unlocks — the listener gets their playback back.
  const transportLocked = Boolean(roomLive) && cap.transportFollowsHost && !roomLive?.state.ended;

  // ── E6.11 listener follow: apply the host's folded transport event to the
  // real audio. Self-echo skipped via actorKey; >2 s drift snaps; play()
  // rejection (autoplay policy) surfaces the tap-to-join affordance.
  const transportEvent = roomLive?.state.transport ?? null;
  useEffect(() => {
    if (!realAudio || !transportEvent || !transportLocked) return;
    const action = planTransportFollow(
      { playing: playingRef.current, position: posRef.current },
      transportEvent,
      meActorKey,
      Date.now(),
    );
    if (action.seekTo != null) {
      if (pitchModeRef.current) {
        graph.pitchSeek(action.seekTo);
      } else {
        const a = audioRef.current;
        if (a) a.currentTime = action.seekTo;
      }
      setPosition(action.seekTo);
    }
    if (action.pause) {
      if (pitchModeRef.current && graph.pitchPlaying()) graph.pitchPause();
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
      setPlaying(false);
    }
    if (action.play) {
      try {
        startPlayback()
          .then(() => setNeedsGesture(false))
          .catch(() => setNeedsGesture(true)); // NotAllowedError without a prior gesture
      } catch {
        setNeedsGesture(true); // engine init refused outside a gesture
      }
    }
  }, [transportEvent, transportLocked, realAudio, graph, startPlayback, meActorKey]);
  useEffect(() => {
    if (!transportLocked) setNeedsGesture(false);
  }, [transportLocked]);

  // "▶ Tap to join playback" — a REAL gesture, so ensureContext + play are allowed.
  const joinPlayback = useCallback(() => {
    try {
      startPlayback()
        .then(() => setNeedsGesture(false))
        .catch((err: unknown) => {
          toast.error(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    } catch (err) {
      toast.error(`Audio engine failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [startPlayback]);

  // Story 11.5 — live seam: a running session's SSE feed replaces the local
  // mock feed, and reactions/status POST to the room. E6.13 — the presence
  // pop only fires when the server ACCEPTED the reaction (no optimistic pop);
  // a rejected status send rolls the local status chip back.
  const feedShown = roomLive ? roomLive.state.feed : feed;
  const reactHandler = (e: string) => {
    if (roomLive) {
      const prevStatus = myStatus;
      setMyStatus(e);
      const live = roomLive;
      void Promise.allSettled([live.sendReact(e, posRef.current), live.sendStatus(e)]).then(
        ([reactRes, statusRes]) => {
          const outcome = reactOutcome({ react: reactRes.status, status: statusRes.status });
          if (outcome.pop) {
            spawnPresence({ handle: identity.actor.handle ?? 'you', hue: identity.actor.hue ?? 168, anon: identity.actor.type === 'anon' }, e);
          }
          if (outcome.toast) toast.error("Reaction didn't send.", { id: 'room-send' });
          if (outcome.revertStatus) setMyStatus(prevStatus);
        },
      );
    } else {
      setMyStatus(e);
      spawnReaction(e, 'maek');
    }
  };

  return (
    <div className="lr-shell" data-testid="listen-rack-page">
      {/* position:relative + z-index lifts the page above the full-screen
          visualizer backdrop (VizStage background mode portals to <body> at
          z-index 0); the global top nav is z-index 50 and stays on top too. */}
      <div className="lr-page" style={{ position: 'relative', zIndex: 1 }}>
        {/* Story 5.10 review: header + room controls hide with the grid <1024 —
            a "desktop-only" page must not leave live-room start/end buttons
            operable under the notice card. */}
        <div className="lr-desktop-only">
        <TrackHeader track={track} mode={mode} modes={modes} identity={identity}
          fixesApplied={fixesApplied} onResetFixes={onResetCarriedFixes}
          reportRef={reportRef}
          {...(identity.isOwner && realAudio && versionId ? { onShare: () => setShareOpen(true) } : {})}
          {...(onModeChange ? { onModeChange } : {})} />

        {mode === 'room' && (roomLive || onStartRoom) && (
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 2px', fontSize: 10.5 }}>
            {roomLive ? (() => {
              // E6.9/E6.10 — honest room chrome per stream/ended state.
              const hs = roomHeaderState(roomLive.streamStatus, roomLive.state.ended);
              if (hs === 'ended') {
                return (
                  <span data-testid="room-ended-banner" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.12em' }}>THIS ROOM HAS ENDED</span>
                    {identity.isHost && roomLive.recapPublished && (
                      <span style={{ color: 'var(--cyan)' }}>Recap published to comments</span>
                    )}
                    {onModeChange && (
                      <button type="button" className="btn sm ghost" style={{ fontSize: 10 }}
                        onClick={() => onModeChange(identity.isOwner ? 'work' : 'view')}>
                        Back to {identity.isOwner ? 'Work' : 'View'}
                      </button>
                    )}
                  </span>
                );
              }
              const dotColor = hs === 'live' ? 'var(--orange)' : hs === 'reconnecting' ? 'var(--yellow)' : 'var(--muted)';
              return (
                <>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--orange)', fontWeight: 700, letterSpacing: '0.12em' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, boxShadow: hs === 'live' ? '0 0 8px var(--orange)' : 'none' }} />
                    LIVE ROOM · {roomLive.state.roster.length} listening
                    {hs === 'reconnecting' && <span style={{ color: 'var(--yellow)', fontWeight: 400, letterSpacing: 'normal' }}> · reconnecting…</span>}
                    {hs === 'lost' && <span style={{ color: 'var(--red)', fontWeight: 400, letterSpacing: 'normal' }}> · connection lost</span>}
                  </span>
                  {hs === 'forbidden' && (
                    <span style={{ color: 'var(--muted)' }}>You no longer have access to this room.</span>
                  )}
                  {hs === 'lost' && (
                    <button type="button" className="btn sm ghost" style={{ fontSize: 10 }} onClick={roomLive.retryStream}>Retry</button>
                  )}
                  {transportLocked && (
                    <span className="pill" style={{ fontSize: 8.5, letterSpacing: '0.1em' }}>FOLLOWING HOST</span>
                  )}
                  {identity.isHost && (
                    <button type="button" className="btn sm ghost" style={{ fontSize: 10 }}
                      disabled={roomLive.isEnding} onClick={roomLive.endRoom}>
                      {roomLive.isEnding ? 'Ending…' : 'End room + publish recap'}
                    </button>
                  )}
                </>
              );
            })() : (
              <button type="button" className="btn sm primary" style={{ fontSize: 10.5 }} onClick={onStartRoom} disabled={isStartingRoom}>
                {isStartingRoom ? '◉ Starting…' : '◉ Start live room'}
              </button>
            )}
          </div>
        )}
        </div>

        {/* Story 5.10 (UX-DR45): Listen is a desktop tool — below the lg
            breakpoint the rack grid + header hide and this notice shows
            instead. Display swap is CSS-only; a matchMedia effect pauses
            playback on crossing below (display:none does NOT stop audio). */}
        <div className="card lr-desktop-notice" data-testid="listen-desktop-notice">
          <p className="label">Desktop tool</p>
          <p>
            The Listen rack needs room for its EQ, meters, and rack modules — open this page on a
            screen at least 1024&nbsp;px wide. Your report and library work great here.
          </p>
        </div>

        <div className="lr-grid">
          <div style={{ minWidth: 0 }}>
            <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
              <PresencePops items={pops} />
              {/* E6.11 — autoplay-policy affordance: the follow-side play()
                  was rejected without a user gesture; this click IS one. */}
              {needsGesture && transportLocked && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 9, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)' }}>
                  <button type="button" className="btn primary" data-testid="tap-to-join-playback" onClick={joinPlayback}>
                    ▶ Tap to join playback
                  </button>
                </div>
              )}
              <VisualMeters track={track} playing={playing} open={metersOpen} setOpen={setMetersOpen}
                frame={realAudio ? meterFrame : null} />
              <VizStage playing={playing} stages={stages} setStages={setStages} viz={viz}
                director={directorObj} height={440} onDrop={handleDrop} myStatus={myStatus} activeModules={activeModules}
                {...(realAudio ? { getFrame: () => graph.readFrame() } : {})} />
              <CoachToast msg={announcement} />
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <Transport track={track} playing={playing} position={position} duration={duration}
                  onTogglePlay={transportLocked ? noopHandler : togglePlay}
                  onSeek={transportLocked ? noopHandler : seek}
                  notes={track.notes}
                  onNoteClick={(n) => { setActiveNote(n.id); if (!transportLocked) seek(n.t); }}
                  activeNote={activeNote} reactions={feedShown} />
                {realAudio && versionId && (
                  <BookmarksRail versionId={versionId} durationSeconds={duration} position={position}
                    onSeek={seek} isOwner={identity.isOwner} />
                )}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              {/* 11.12: the chip is the ONLY Submit/Discard surface — it must
                  survive a bottom-view switch to VISUALS/STEMS or the reviewer
                  is stranded in an invisible fork (review finding). */}
              {suggesting && (
                <SuggestModeChip playing={playing} abSide={abSide} submitting={createSuggestionMut.isPending}
                  onToggleAb={toggleAbSide} onSubmit={submitSuggestion} onDiscard={() => endSuggesting(true)} />
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setBottomView('rack')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'rack' ? '#06151a' : 'var(--muted)', background: bottomView === 'rack' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'rack' ? 'transparent' : 'var(--border)') }}>▦ RACK</button>
                <button type="button" onClick={() => setBottomView('lights')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'lights' ? '#06151a' : 'var(--muted)', background: bottomView === 'lights' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'lights' ? 'transparent' : 'var(--border)') }}>☀ VISUALS</button>
                {realAudio && (
                  <button type="button" onClick={() => setBottomView('stems')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, color: bottomView === 'stems' ? '#06151a' : 'var(--muted)', background: bottomView === 'stems' ? 'var(--cyan)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (bottomView === 'stems' ? 'transparent' : 'var(--border)') }}>♫ STEMS</button>
                )}
                {bottomView !== 'stems' && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      if (bottomView === 'rack') onRecallRackPreset(e.target.value);
                      else onRecallVizLook(e.target.value);
                    }}
                    className="mono" style={{ fontSize: 10, background: 'var(--card-2)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px' }}
                  >
                    <option value="">Presets ({(bottomView === 'rack' ? rackPresetItems : vizPresetItems).length})</option>
                    {(bottomView === 'rack' ? rackPresetItems : vizPresetItems).map((p: RackPreset | VizPreset) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => (bottomView === 'rack' ? onSaveRackPreset() : onSaveVizLook())} className="btn sm primary" style={{ fontSize: 10.5 }}>+ Save preset</button>
                  {bottomView === 'rack' && realAudio && (
                    <>
                      <button type="button" onClick={onExportPreset} className="btn sm ghost" style={{ fontSize: 10.5 }}>↧ Export</button>
                      <button type="button" onClick={() => importInputRef.current?.click()} className="btn sm ghost" style={{ fontSize: 10.5 }}>↥ Import</button>
                      <input ref={importInputRef} type="file" accept="application/json,.json" onChange={onImportFile} style={{ display: 'none' }} />
                    </>
                  )}
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
                </div>)}
              </div>
              {bottomView === 'rack'
                ? (() => {
                    const surface = resolveRackSurface({
                      rackReadOnly, suggesting, abSide, canSuggest: cap.canSuggest, mode, realAudio,
                    });
                    if (surface.editable) {
                      return <InlineRack rs={rs} playing={playing} controller={roomControl.rackHolder?.handle ?? null} />;
                    }
                    return (
                      <div style={{ position: 'relative' }}>
                        <div style={{ pointerEvents: 'none', opacity: 0.9 }}>
                          <InlineRack rs={rs} playing={playing} controller={roomControl.rackHolder?.handle ?? null} />
                        </div>
                        {/* Story 11.12: the "FORK TO SUGGEST" fragment is a real button in
                            View mode; while A/B'ing the original, the overlay blocks edits
                            (editing the original by accident would corrupt the draft). */}
                        {surface.badge === 'original-block' ? (
                          <div className="mono" style={{ position: 'absolute', top: 12, right: 14, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--violet)', padding: '4px 9px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)' }}>ORIGINAL (A) — FLIP BACK TO EDIT</div>
                        ) : surface.badge === 'fork-button' ? (
                          <button type="button" data-testid="fork-to-suggest-badge" onClick={startSuggesting}
                            className="mono" style={{ position: 'absolute', top: 12, right: 14, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--violet)', padding: '4px 9px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)', cursor: 'pointer' }}>
                            READ-ONLY · ⌁ FORK TO SUGGEST
                          </button>
                        ) : (
                          <div className="mono" style={{ position: 'absolute', top: 12, right: 14, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--violet)', padding: '4px 9px', borderRadius: 7, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)' }}>READ-ONLY</div>
                        )}
                      </div>
                    );
                  })()
                : bottomView === 'stems'
                  ? <StemDeck stems={deckStems} isLoading={stemsLoading} stemUrl={stemUrl} engine={stemEngine}
                      playing={stemPlaying} onActivate={activateStemMode} onPlayPause={setStemPlaying} />
                  : <VisualsPanel stages={stages} toggleStage={toggleStage} director={director} setDirector={chooseDirector} viz={viz} setViz={setViz} onRandomize={randomizeViz} />}
            </div>
          </div>

          <RightRail mode={mode} access={access} cap={cap} rs={rs} track={track} position={position}
            activeNote={activeNote} onNoteClick={(n) => { setActiveNote(n.id); seek(n.t); }} onSeek={seek}
            onReact={reactHandler} feed={feedShown} announce={announce} myStatus={myStatus}
            roomControl={roomControl} onGrant={grantControl} isOwner={identity.isOwner} {...(versionId ? { versionId } : {})}
            real={realAudio} reportRef={reportRef} statsSource={statsSource}
            roster={roomLive ? roomLive.state.roster : null}
            onInvite={identity.isOwner && realAudio && versionId ? () => setShareOpen(true) : undefined}
            {...(roomLive ? { statusByActor: roomLive.state.statusByActor } : {})}
            meKey={roomLive ? meActorKey : null}
            chatLive={roomLive ? { send: roomLive.sendChat, position: () => posRef.current } : null}
            roomPhase={roomLive ? roomHeaderState(roomLive.streamStatus, roomLive.state.ended) : null}
            {...(cap.canSuggest && mode === 'view' && realAudio && !suggesting ? { onForkToSuggest: startSuggesting } : {})}
            {...(auditionSeam ? { audition: auditionSeam } : {})} />
        </div>
      </div>

      {identity.isOwner && realAudio && versionId && (
        <VersionShareDialog open={shareOpen} onOpenChange={setShareOpen}
          versionId={versionId} songName={track.name} />
      )}

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />
      )}
    </div>
  );
}
