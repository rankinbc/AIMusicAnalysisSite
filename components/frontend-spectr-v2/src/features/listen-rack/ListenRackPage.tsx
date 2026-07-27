/* SPECTR · Listen — Rack v2 (results-density redesign, ported page container)
 *
 * Analysis-Results design language at high density: slim header row, calibrated
 * spectrum stage + transport, Rack / Visuals / Coach tabs, session sidebar
 * (Notes · Chat · Room), page-wide light-show atmosphere. Ported from the
 * design handoff (PRPs/design_handoffs/design_handoff_listen_rack_v2) onto the
 * REAL seams: audio graph, rack state, server presets/draft, 12.4 fix
 * carry-over, live room SSE. The Stem Deck and fork-to-suggest surfaces were
 * retired with this redesign (2026-07-24) — their modules remain in the repo.
 *
 * The playback clock and meters are real on the versioned route; the demo
 * route (no versionId) keeps the mock rAF clock + simulated meters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { fetcher, getAccessToken } from '../../api/fetcher';
import { createMediaRetry } from '../listen/media-retry';
import { useAudioGraph } from '../listen/useAudioGraph';
import { VersionShareDialog } from '../listen/VersionShareDialog';
import { CoverArt } from '../../ui/CoverArt';
import { Icon } from '../results/Icon';
import '../results/redesign-v3.css';
import './listen-rack-v2.css';
import './listen-rack-v2-extras.css';
import { MODE_SURFACE_MATRIX, type AccessDto, type ActorRef, type ModeId } from './access';
import { resolveCapabilities } from './capabilities';
import { CoachTabV2 } from './CoachTabV2';
import {
  COACH_SUGGESTIONS, DEFAULT_VIZ, DIRECTORS, MANIFEST_BY_ID, REACTION_EMOJI, ROOM_LISTENERS, TRACK,
  type Director, type ModuleManifest, type ModuleState, type PresencePopItem,
  type ReactionFeedItem, type Track, type VizState,
} from './data';
import { overlayChain } from './fixToRackPatch';
import { type Identity, type RoomControl } from './identity';
import { LightShow } from './LightShow';
import { clearFixOverlay, readListenFixes } from './listenFixes';
import { lrTime } from './lrUtil';
import { pushFullRack } from './rackBindings';
import { RackTabV2 } from './RackTabV2';
import { useRackState, type RackPreset } from './rackState';
import type { ReportRef, StatsSource } from './rail';
import { actorKey } from './roomStateReducer';
import { roomHeaderState } from './roomUiState';
import { SessionSidebarV2 } from './SessionSidebarV2';
import { StageCardV2 } from './StageCardV2';
import { useLiveMeters, type LiveMeters } from './useLiveMeters';
import { planTransportEmit, planTransportFollow } from './transportSync';
import type { Chain } from './chain';
import type { RoomLiveSeam } from './useRoomOrchestration';
import {
  asChain, buildExportEnvelope, parseImportEnvelope, resolveDraftRestore, useRackDraft,
  useRackDraftAutosave, useRackPreset, useRackPresets, useSaveRackPreset,
} from './useRackPresets';
import { isInsertEffect } from './rackBindings';
import { VisualsTabV2 } from './VisualsTabV2';

// Locked-transport stand-in (guests following the host).
const noopHandler = () => undefined;

// Design-handoff tweak defaults, frozen (the Tweaks panel was scaffold).
const STAGE_HEIGHT = 210;
// Meters moved into the rack toolbar's LCD module (MeterLcd in RackTabV2) —
// the stage overlay chips stay off so the numbers live in one place.
const SHOW_STAGE_METERS = false;
const SHOW_NOTE_PINS = true;

// Exported for the 12.4 chip render test (all-modes assertion). Slim v2 header:
// 38px cover · title · one mono stat line · Invite + View report.
export function TrackHeader({ track, mode, modes, onModeChange, fixesApplied, onResetFixes, reportRef, onShare, meters, playing = false, activeModules = null, bypassed = false }: {
  track: Track; mode: ModeId; modes: ModeId[]; identity: Identity; onModeChange?: (m: ModeId) => void;
  /** Story 12.4: carried-fix chip — renders in EVERY mode. null = no carry. */
  fixesApplied?: number | null; onResetFixes?: () => void;
  reportRef?: ReportRef | null;
  onShare?: () => void;
  /** Live output meters for the stat line (LUFS / dBTP). */
  meters?: LiveMeters;
  playing?: boolean;
  activeModules?: number | null;
  bypassed?: boolean;
}) {
  const t = track;
  const showSwitcher = onModeChange && modes.length > 1;
  const surface = MODE_SURFACE_MATRIX[mode];
  return (
    <div className="lr-head">
      <span className="cov"><CoverArt hue={168} size="sm" style={{ width: 38, height: 38, borderRadius: 9 }} /></span>
      <span className="lr-htitle">
        <span className="n">{t.name}</span>
        <span className="lr-stats">
          <span className="lr-live"><i />{playing ? 'LISTENING' : 'PAUSED'}</span>
          {t.bpm > 0 && <><b>{t.bpm}</b> BPM<span className="sep">·</span></>}
          {t.key !== '—' && <><b>{t.key}</b><span className="sep">·</span></>}
          {lrTime(t.durationSec)}
          {t.format && <span className="lo"><span className="sep">·</span>{t.format}</span>}
          {meters && (
            <>
              <span className="sep">·</span><b>{meters.lufs.toFixed(1)}</b> LUFS
              <span className="sep">·</span><b>{meters.tp.toFixed(1)}</b> dBTP
            </>
          )}
          {t.grade && <span className="md"><span className="sep">·</span>grade <span className="ac">{t.grade}</span></span>}
          {activeModules != null && (
            <span className="lo">
              <span className="sep">·</span>
              <span className="ac">{bypassed ? 'chain bypassed' : activeModules + ' modules on'}</span>
            </span>
          )}
          {fixesApplied != null && fixesApplied > 0 && (
            <span data-testid="fixes-applied-chip">
              <span className="sep">·</span>
              <span className="ac">Fixes applied: {fixesApplied}</span>
              {onResetFixes && (
                <button
                  type="button"
                  onClick={onResetFixes}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', font: 'inherit', padding: 0, marginLeft: 6, textDecoration: 'underline' }}
                >
                  reset
                </button>
              )}
            </span>
          )}
        </span>
      </span>
      <span className="sp" />
      {showSwitcher && (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {modes.map((id) => (
            <button
              type="button"
              key={id}
              className={'btn sm' + (id === mode ? ' primary' : ' ghost')}
              style={id === mode && surface.accent ? { background: surface.accent, borderColor: 'transparent' } : undefined}
              onClick={() => onModeChange(id)}
            >
              {MODE_SURFACE_MATRIX[id].label}
            </button>
          ))}
        </span>
      )}
      {onShare && (
        <button type="button" className="btn sm ghost" title="Share this session" onClick={onShare}>
          <Icon name="users" size={13} />Invite
        </button>
      )}
      {reportRef && (
        <Link
          to="/songs/$songId/results/$jobId"
          params={{ songId: reportRef.songId, jobId: reportRef.jobId }}
          className="btn sm primary"
        >
          View report<Icon name="arrow" size={13} />
        </Link>
      )}
    </div>
  );
}

function Pop({ p }: { p: PresencePopItem }) {
  return (
    <div style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, animation: 'presencePop 2.7s cubic-bezier(.2,.8,.2,1) forwards' }}>
      <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
        <span style={{ position: 'absolute', width: 40, height: 40, borderRadius: '50%', border: `2px solid ${p.ring}`, animation: 'ringPulse 1.1s ease-out forwards' }} />
        <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, color: '#06151a', background: `oklch(0.74 0.15 ${p.hue})` }}>
          {p.anon ? '?' : (p.handle[0] ?? '?').toUpperCase()}
        </span>
        <span style={{ position: 'absolute', bottom: -8, right: -10, fontSize: 18, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }}>{p.emoji}</span>
      </div>
      <div className="mono" style={{ textAlign: 'center', marginTop: 5, fontSize: 9, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' }}>
        {p.anon ? 'anon' : '@' + p.handle}
      </div>
    </div>
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
  /** When set, the page plays the real uploaded audio for this version;
   *  omitted = mock rAF transport clock (demo route). */
  versionId?: string;
  track?: Track;
  /** Story 11.5 — live SSE room seam. */
  roomLive?: RoomLiveSeam | null;
  onStartRoom?: (() => void) | undefined;
  isStartingRoom?: boolean;
  /** Story 12.4 — the fix-rack carry-over preset id (?fixPreset=). */
  fixPreset?: string;
  reportRef?: ReportRef | null;
  /** Wave-3 E6.3 — retained for the route contract (no Stats rail in v2). */
  statsSource?: StatsSource | null;
}

const LR_TABS = [
  ['rack', 'Rack', 'sliders'],
  ['visuals', 'Visuals', 'sparkle'],
  ['coach', 'Coach', 'robot'],
] as const;

export function ListenRackPage({ mode, modes, identity, access, roomControl, onModeChange, onGrant, versionId, track: trackProp, roomLive, onStartRoom, isStartingRoom = false, fixPreset, reportRef = null }: ListenRackPageProps) {
  const track = trackProp ?? TRACK;
  // ── Real-audio seam ──
  const realAudio = versionId != null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useAudioGraph(audioRef);
  const audioUrl = useMemo(() => {
    if (!versionId) return null;
    const token = getAccessToken();
    if (!token) return null;
    // Dep is [versionId] ONLY — a silent refresh must not re-mount <audio>.
    return `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}`;
  }, [versionId]);

  // DEV-ONLY smoke harness (dead-code-eliminated in production builds).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __spectrRackGraph?: typeof graph }).__spectrRackGraph = graph;
  }, [graph]);

  const [tab, setTab] = useState<'rack' | 'visuals' | 'coach'>('rack');
  const [playing, setPlaying] = useState(!realAudio);
  const [position, setPosition] = useState(realAudio ? 0 : 42);
  const [duration, setDuration] = useState(realAudio ? 0 : track.durationSec);
  const [director, setDirector] = useState('off');
  const [viz, setViz] = useState<VizState>(DEFAULT_VIZ);
  const [stages, setStages] = useState<string[]>(['eq']);
  const toggleStage = useCallback((id: string) => setStages((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id])), []);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [pops, setPops] = useState<PresencePopItem[]>([]);
  const [feed, setFeed] = useState<ReactionFeedItem[]>([]);
  const [myStatus, setMyStatus] = useState('🎧');
  const [shareOpen, setShareOpen] = useState(false);

  const rs = useRackState(realAudio ? graph : null);
  const rsRef = useRef(rs);
  rsRef.current = rs;

  // ── Server-backed rack presets + draft ─────────────────────────────────────
  const currentChain = useMemo<Chain>(
    () => ({ order: rs.order, modules: rs.mod, masterBypass: rs.masterBypass }),
    [rs.order, rs.mod, rs.masterBypass],
  );
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

  // ── Story 12.4: fix-rack carry-over (?fixPreset=) ──────────────────────────
  const carryAllowedNow = Boolean(
    fixPreset && realAudio && !resolveCapabilities(mode, identity, roomControl, access).rackReadOnly,
  );
  const carryArmedRef = useRef<boolean | null>(null);
  if (carryArmedRef.current === null) carryArmedRef.current = carryAllowedNow;
  const carryArmed = Boolean(fixPreset) && carryArmedRef.current === true;
  const carriedPresetQuery = useRackPreset(
    realAudio ? (versionId ?? '') : '', carryArmed ? fixPreset : undefined);
  const [fixesApplied, setFixesApplied] = useState<number | null>(null);
  const [carryPhase, setCarryPhase] = useState<'none' | 'pending' | 'applied' | 'failed'>(
    carryArmed ? 'pending' : 'none');
  const appliedPresetRef = useRef<string | null>(null); // one-shot per preset id
  const navigate = useNavigate();

  useEffect(() => {
    if (!fixPreset || appliedPresetRef.current === fixPreset) return;
    carryArmedRef.current = carryAllowedNow;
    if (carryArmedRef.current) setCarryPhase('pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm keys on the param only
  }, [fixPreset]);

  // Autosaved draft: restore once when it resolves, then debounced autosave.
  const draftQuery = useRackDraft(realAudio ? (versionId ?? '') : '');
  const {
    isError: draftIsError, isFetched: draftIsFetched, data: draftData,
    refetch: refetchDraft,
  } = draftQuery;
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    const decision = resolveDraftRestore({
      draftRestored, realAudio, carryPhase,
      isError: draftIsError, isFetched: draftIsFetched,
    });
    if (decision === 'wait') return;
    if (decision === 'pause') {
      toast.error("Couldn't load your saved rack draft — autosave is paused.", {
        id: 'rack-draft-load',
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
    setDraftRestored(true);
  }, [draftRestored, realAudio, carryPhase, draftIsError, draftIsFetched, draftData, refetchDraft]);
  useRackDraftAutosave(versionId ?? '', currentChain, realAudio && draftRestored);

  // Apply the carried chain ONCE per preset id when it resolves.
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
    const applied = chain
      ? Object.entries(chain.modules).filter(([id, m]) => id !== 'pitch' && m?.enabled).length
      : 0;
    appliedPresetRef.current = fixPreset;
    if (!chain || applied === 0) {
      setCarryPhase('failed');
      toast.error('The carried fix rack could not be applied.');
      return;
    }
    rsRef.current.applyRackMod(overlayChain(rsRef.current.mod, chain.modules));
    rsRef.current.setMasterBypass(chain.masterBypass);
    setFixesApplied(applied);
    setCarryPhase('applied');
  }, [carryArmed, fixPreset, carriedPresetQuery.isError, carriedPresetQuery.data]);

  const onResetCarriedFixes = useCallback(() => {
    rsRef.current.reset();
    if (versionId) clearFixOverlay(versionId);
    setFixesApplied(null);
    setCarryPhase('none');
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId: versionId ?? '' },
      search: (prev: Record<string, unknown>) => {
        const rest = { ...prev };
        delete rest['fixPreset'];
        return rest;
      },
      replace: true,
    });
  }, [versionId, navigate]);

  // Unified preset handlers — server on the real route, in-memory on mock.
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
      rs.setMasterBypass(chain.masterBypass);
    } else {
      const p = rs.presets.find((x) => x.id === id);
      if (p) rs.recallPreset(p);
    }
  }, [realAudio, rackPresetDtos, rs]);
  const rackPresetItems = realAudio ? serverRackPresets : rs.presets;

  // JSON export/import — the portability path (real route only).
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
    e.target.value = '';
    if (!file) return;
    try {
      const { name, chain } = parseImportEnvelope(await file.text());
      saveRackPresetMut.mutate({ name, chain }, { onSuccess: () => toast.success(`Imported "${name}".`) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    }
  }, [saveRackPresetMut]);

  // ── Pitch lane: separate buffer lane (NOT an insert). ──
  const pitchModeRef = useRef(false);
  const [pitchActive, setPitchActive] = useState(false);
  const pitchEnabled = realAudio && !!rs.mod['pitch']?.enabled;
  const pitchSemitones = Number(rs.mod['pitch']?.['semitones']) || 0;
  const pitchCents = Number(rs.mod['pitch']?.['cents']) || 0;
  const pitchTempo = Number(rs.mod['pitch']?.['tempo']) || 1;

  // Story 5.10: crossing below the lg breakpoint pauses every lane.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const pauseAll = () => {
      if (!mq.matches) return;
      if (pitchModeRef.current && graph.pitchPlaying()) graph.pitchPause();
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
      setPlaying(false);
    };
    pauseAll();
    mq.addEventListener('change', pauseAll);
    return () => mq.removeEventListener('change', pauseAll);
  }, [graph]);

  const posRef = useRef(position); posRef.current = position;
  const modeRef = useRef(mode); modeRef.current = mode;
  const playingRef = useRef(playing); playingRef.current = playing;
  const roomLiveRef = useRef(roomLive); roomLiveRef.current = roomLive;
  const isHostRef = useRef(identity.isHost); isHostRef.current = identity.isHost;
  const meActorKey = useMemo(() => actorKey(identity.actor), [identity.actor]);
  const [needsGesture, setNeedsGesture] = useState(false);

  // ── E6.11 host transport emit ──
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
    if (seekEmitTimerRef.current !== null) return;
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

  const chooseDirector = useCallback((id: string) => {
    setDirector(id);
    const d = DIRECTORS.find((x) => x.id === id);
    if (d && d.apply && !d.behaviorOnly) setViz((s) => ({ ...s, ...d.apply }));
  }, []);
  const directorObj: Director | undefined = useMemo(
    () => DIRECTORS.find((d) => d.id === director), [director]);
  const activeModuleManifests: ModuleManifest[] = useMemo(
    () => rs.order.filter((id) => rs.mod[id]?.enabled).map((id) => MANIFEST_BY_ID[id]).filter((m): m is ModuleManifest => m != null),
    [rs.order, rs.mod]);

  // ── Transport clock (MOCK rAF) — demo route only ──
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

  // ── Real-audio transport (element-driven). ──
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const onTime = () => setPosition(a.currentTime);
    const onDur = () => { if (Number.isFinite(a.duration)) setDuration(a.duration); };
    const onEnd = () => setPlaying(false);
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
      retry.dispose();
    };
  }, [audioUrl, versionId]);

  // Apply detune + tempo to the live BufferSource. Tempo lets the user cancel
  // detune's speed coupling (e.g. +5 st ≈ ×1.335 speed → tempo 0.75 ≈ original
  // speed at the shifted pitch).
  useEffect(() => {
    if (!pitchActive) return;
    graph.setPitchDetune(pitchSemitones, pitchCents);
    graph.setPitchRate(pitchTempo);
  }, [pitchSemitones, pitchCents, pitchTempo, pitchActive, graph]);

  // Enter/exit the pitch buffer lane on the rack's pitch toggle.
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
    // semitones/cents are intentionally excluded — the detune effect owns those.
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

  // Room mode: kick the auto program on so the page reads as a show.
  useEffect(() => {
    if (mode === 'room' && director === 'off') chooseDirector('club');
  }, [mode, director, chooseDirector]);

  // Drop moment (fireworks): in room mode the listeners cheer on the stage.
  const handleDrop = useCallback(() => {
    if (modeRef.current !== 'room') return;
    ROOM_LISTENERS.filter(() => Math.random() < 0.75).forEach((u, i) => setTimeout(() => spawnPresenceRef.current(u, '🔥'), i * 130));
  }, []);
  const spawnPresence = useCallback((listener: { handle: string; hue: number; anon?: boolean | undefined }, emoji: string) => {
    const id = Math.random().toString(36).slice(2);
    const x = 8 + Math.random() * 80;
    const y = 20 + Math.random() * 44;
    setPops((p) => [...p, { id, handle: listener.handle, hue: listener.hue, anon: listener.anon, emoji, x, y, ring: `oklch(0.72 0.16 ${listener.hue || 168})` }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 2700);
  }, []);
  const spawnPresenceRef = useRef(spawnPresence);
  spawnPresenceRef.current = spawnPresence;
  const spawnReaction = useCallback((emoji: string, handle: string) => {
    const u = ROOM_LISTENERS.find((x) => x.handle === handle) ?? ROOM_LISTENERS[0];
    if (!u) return;
    spawnPresence(u, emoji);
    setFeed((fd) => [{ id: Math.random().toString(36).slice(2), emoji, handle: u.handle, text: '', t: Math.floor(posRef.current), you: u.you }, ...fd].slice(0, 14));
  }, [spawnPresence]);

  // Ambient MOCK reactions — demo only; live sessions stream via SSE.
  useEffect(() => {
    if (!playing || mode !== 'room' || roomLive) return undefined;
    const iv = setInterval(() => {
      if (Math.random() < 0.6) {
        const u = ROOM_LISTENERS[1 + Math.floor(Math.random() * (ROOM_LISTENERS.length - 1))];
        const e = REACTION_EMOJI[Math.floor(Math.random() * REACTION_EMOJI.length)];
        if (u && e) spawnReaction(e, u.handle);
      }
    }, 2800);
    return () => clearInterval(iv);
  }, [playing, mode, spawnReaction, roomLive]);

  // Shared play internals — ensureContext + full-rack sync on every play.
  const startPlayback = useCallback((): Promise<void> => {
    const a = audioRef.current;
    if (!a) return Promise.resolve();
    graph.ensureContext();
    pushFullRack(graph, rsRef.current.mod, rsRef.current.order, rsRef.current.masterBypass);
    return a.play().then(() => setPlaying(true));
  }, [graph]);

  const togglePlay = useCallback(() => {
    if (!realAudio) { setPlaying((p) => !p); return; }
    const a = audioRef.current;
    if (!a) return;
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
  }, [realAudio, graph, startPlayback, emitTransport]);

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
  const transportLocked = Boolean(roomLive) && cap.transportFollowsHost && !roomLive?.state.ended;

  // ── E6.11 listener follow ──
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
          .catch(() => setNeedsGesture(true));
      } catch {
        setNeedsGesture(true);
      }
    }
  }, [transportEvent, transportLocked, realAudio, graph, startPlayback, meActorKey]);
  useEffect(() => {
    if (!transportLocked) setNeedsGesture(false);
  }, [transportLocked]);

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

  const grantControl = useCallback((scope: 'rack' | 'visuals', actor: ActorRef | null) => {
    onGrant?.(scope, actor);
    const who = actor ? `@${actor.handle ?? actor.displayName ?? 'someone'}` : 'the host';
    toast.success(`${who} can now control the ${scope === 'rack' ? 'rack' : 'visuals'}`);
  }, [onGrant]);

  // Live seam: reactions/status POST to the room; E6.13 pop only on accept.
  const feedShown = roomLive ? roomLive.state.feed : feed;
  const reactHandler = (e: string) => {
    if (roomLive) {
      const prevStatus = myStatus;
      setMyStatus(e);
      const live = roomLive;
      void Promise.allSettled([live.sendReact(e, posRef.current), live.sendStatus(e)]).then(
        ([reactRes, statusRes]) => {
          if (reactRes.status === 'fulfilled') {
            spawnPresence({ handle: identity.actor.handle ?? 'you', hue: identity.actor.hue ?? 168, anon: identity.actor.type === 'anon' }, e);
          } else {
            toast.error("Reaction didn't send.", { id: 'room-send' });
          }
          if (statusRes.status === 'rejected') setMyStatus(prevStatus);
        },
      );
    } else {
      setMyStatus(e);
      spawnReaction(e, 'maek');
    }
  };

  // Live meters for the stage chips + header stat line. `getFrame` is memoized
  // so the meter interval + stage rAF don't resubscribe every render.
  const getFrame = useMemo(
    () => (realAudio ? () => graph.readFrame() : null),
    [realAudio, graph],
  );
  const readGr = useCallback((): number => {
    if (!realAudio) return 0;
    let worst = 0;
    for (const id of ['comp', 'gate', 'limiter']) {
      if (!isInsertEffect(id) || !rsRef.current.mod[id]?.enabled) continue;
      const v = graph.readEffectMeter(id)?.reductionDb;
      if (typeof v === 'number' && Number.isFinite(v)) worst = Math.max(worst, Math.abs(v));
    }
    return worst;
  }, [realAudio, graph]);
  const meters = useLiveMeters(
    playing, rs.mod, rs.masterBypass, getFrame, realAudio ? readGr : null,
  );

  // Current arrangement section under the playhead (null without sections).
  const section = useMemo(() => {
    const secs = track.arrangement.sections;
    if (!secs.length || duration <= 0) return null;
    const total = secs.reduce((s, x) => s + x.bars, 0);
    let acc = 0;
    const pct = position / duration;
    for (const s of secs) {
      const w = s.bars / total;
      if (pct >= acc && pct < acc + w) return s.l;
      acc += w;
    }
    return secs[0]?.l ?? null;
  }, [track, position, duration]);

  const activeCount = rs.order.filter((id) => rs.mod[id]?.enabled).length;
  const coachCount = realAudio
    ? (versionId ? readListenFixes(versionId).length : 0)
    : COACH_SUGGESTIONS.length;
  const onNote = useCallback((n: { id: string; t: number }) => {
    setActiveNote(n.id);
    if (!transportLocked) seek(n.t);
  }, [seek, transportLocked]);

  return (
    <div className="rdx lr-shell" data-testid="listen-rack-page">
      <LightShow playing={playing} intensity={1} show />
      <div className="wrap lr-glass" data-density="dense" style={{ position: 'relative', zIndex: 1 }}>
        {/* Story 5.10: everything hides with the grid <1024 — the notice card
            must never leave live-room controls operable underneath it. */}
        <div className="lr-desktop-only">
          {reportRef && (
            <Link to="/songs/$songId" params={{ songId: reportRef.songId }} className="backlink">
              <Icon name="back" size={14} />all versions
            </Link>
          )}
          <TrackHeader
            track={track} mode={mode} modes={modes} identity={identity}
            fixesApplied={fixesApplied} onResetFixes={onResetCarriedFixes}
            reportRef={reportRef} meters={meters} playing={playing}
            activeModules={activeCount} bypassed={rs.masterBypass}
            {...(identity.isOwner && realAudio && versionId ? { onShare: () => setShareOpen(true) } : {})}
            {...(onModeChange ? { onModeChange } : {})}
          />

          {mode === 'room' && (roomLive || onStartRoom) && (
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 2px', fontSize: 10.5 }}>
              {roomLive ? (() => {
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

          <StageCardV2
            playing={playing}
            onPlay={transportLocked ? noopHandler : togglePlay}
            position={position}
            duration={duration}
            onSeek={transportLocked ? noopHandler : seek}
            mod={rs.mod}
            order={rs.order}
            bypass={rs.masterBypass}
            meters={meters}
            stageHeight={STAGE_HEIGHT}
            showMeters={SHOW_STAGE_METERS}
            notes={track.notes}
            activeNote={activeNote}
            onNote={onNote}
            showNotes={SHOW_NOTE_PINS}
            section={section}
            bpm={track.bpm}
            keyLabel={track.key}
            getFrame={getFrame}
            viz={viz}
            stages={stages}
            setStages={setStages}
            director={directorObj}
            myStatus={myStatus}
            activeModules={activeModuleManifests}
            onDrop={handleDrop}
            trackName={track.name}
            trackSub={track.grade ? `grade ${track.grade}` : 'Listen session'}
          >
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 8 }}>
              {pops.map((p) => <Pop key={p.id} p={p} />)}
            </div>
            {needsGesture && transportLocked && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 9, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)' }}>
                <button type="button" className="btn primary" data-testid="tap-to-join-playback" onClick={joinPlayback}>
                  ▶ Tap to join playback
                </button>
              </div>
            )}
          </StageCardV2>

          {/* Sidebar (Notes · Chat · Room) lives OUTSIDE the tabbody so it reads
              as its own box beside the rack panel, not a column inside it. The
              rtabs strip stays stacked with the tabbody in the left column. */}
          <div className="lr-layout">
            <div style={{ minWidth: 0 }}>
              <div className="rtabs">
                {LR_TABS.map(([id, label, icon]) => (
                  <button type="button" key={id} className={'rtab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
                    <span className="ic"><Icon name={icon} size={14} /></span>{label}
                    {id === 'rack' && <span className="rtab-badge">{activeCount}</span>}
                    {id === 'coach' && coachCount > 0 && <span className="rtab-badge">{coachCount}</span>}
                  </button>
                ))}
              </div>
              <div className="tabbody">
                {tab === 'rack' && (
                  <RackTabV2
                    rs={rs}
                    playing={playing}
                    meters={meters}
                    bpm={track.bpm}
                    readOnly={rackReadOnly}
                    presets={rackPresetItems}
                    onRecallPreset={onRecallRackPreset}
                    onSavePreset={onSaveRackPreset}
                    onExport={realAudio ? onExportPreset : undefined}
                    onImport={realAudio ? () => importInputRef.current?.click() : undefined}
                  />
                )}
                {tab === 'visuals' && (
                  <VisualsTabV2
                    viz={viz}
                    setViz={setViz}
                    stages={stages}
                    toggleStage={toggleStage}
                    director={director}
                    setDirector={chooseDirector}
                  />
                )}
                {tab === 'coach' && (
                  <CoachTabV2 rs={rs} real={realAudio} versionId={versionId ?? null} reportRef={reportRef} />
                )}
              </div>
            </div>
            <SessionSidebarV2
              notes={track.notes}
              activeNote={activeNote}
              onNote={onNote}
              feed={roomLive ? feedShown : null}
              chatLive={roomLive ? { send: roomLive.sendChat, position: () => posRef.current } : null}
              myHandle={identity.actor.handle ?? 'you'}
              roster={roomLive ? roomLive.state.roster : null}
              statusByActor={roomLive ? roomLive.state.statusByActor : null}
              meKey={roomLive ? meActorKey : null}
              myStatus={myStatus}
              onReact={reactHandler}
              canGrant={cap.canGrantControl}
              roomControl={roomControl}
              onGrant={grantControl}
            />
          </div>
        </div>

        {/* Story 5.10 (UX-DR45): Listen is a desktop tool. */}
        <div className="card lr-desktop-notice" data-testid="listen-desktop-notice">
          <p className="label">Desktop tool</p>
          <p>
            The Listen rack needs room for its EQ, meters, and rack modules — open this page on a
            screen at least 1024&nbsp;px wide. Your report and library work great here.
          </p>
        </div>
      </div>

      <input ref={importInputRef} type="file" accept="application/json,.json" onChange={onImportFile} style={{ display: 'none' }} />

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
