/* SPECTR · Listen — Rack v2 (results-density redesign, ported page container)
 *
 * Analysis-Results design language at high density: slim header row, calibrated
 * spectrum stage + transport, Rack / Visuals / Coach tabs, notes sidebar,
 * page-wide light-show atmosphere. Ported from the design handoff
 * (PRPs/design_handoffs/design_handoff_listen_rack_v2) onto the REAL seams:
 * audio graph, rack state, server presets/draft, 12.4 fix carry-over. The Stem
 * Deck surface was retired with this redesign (2026-07-24) — its modules
 * remain in the repo. This is a private workbench: no rooms, no access modes,
 * no guest path.
 *
 * The playback clock and meters are real on the versioned route; the demo
 * route (no versionId) keeps the mock rAF clock + simulated meters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';

import { fetcher, getAccessToken } from '../../api/fetcher';
import { createMediaRetry } from '../listen/media-retry';
import { useAudioGraph } from '../listen/useAudioGraph';
import { CoverArt } from '../../ui/CoverArt';
import { Icon } from '../results/Icon';
import '../results/redesign-v3.css';
import '../results/redesign-v3-tabs.css';
import './listen-rack-v2.css';
import './listen-rack-v2-extras.css';
import './findings/findings-stage.css';
import { CoachTabV2 } from './CoachTabV2';
import {
  COACH_SUGGESTIONS, DEFAULT_VIZ, DIRECTORS, MANIFEST_BY_ID, TRACK,
  type Director, type ModuleManifest, type Track, type VizState,
} from './data';
import { FindingsStage } from './findings/FindingsStage';
import { useListenFindings } from './findings/useListenFindings';
import { useStagePrefs } from './findings/stage-prefs';
import { LightShow } from './LightShow';
import { readListenFixes } from './listenFixes';
import { lrTime } from './lrUtil';
import { NotesSidebar } from './NotesSidebar';
import { pushFullRack } from './rackBindings';
import { RackTabV2 } from './RackTabV2';
import { useRackState } from './rackState';
import type { ReportRef, StatsSource } from './types';
import { StageCardV2 } from './StageCardV2';
import { useLiveMeters, type LiveMeters } from './useLiveMeters';
import type { Chain } from './chain';
import { useFixCarryOver } from './useFixCarryOver';
import { useRackPresetActions } from './useRackPresetActions';
import { isInsertEffect } from './rackBindings';
import { VisualsTabV2 } from './VisualsTabV2';

// Design-handoff tweak defaults, frozen (the Tweaks panel was scaffold).
const STAGE_HEIGHT = 210;
// Meters moved into the rack toolbar's LCD module (MeterLcd in RackTabV2) —
// the stage overlay chips stay off so the numbers live in one place.
const SHOW_STAGE_METERS = false;
const SHOW_NOTE_PINS = true;

// Exported for the 12.4 chip render test. Slim v2 header:
// 38px cover · title · one mono stat line · View report.
export function TrackHeader({ track, fixesApplied, onResetFixes, reportRef, meters, playing = false, activeModules = null, bypassed = false }: {
  track: Track;
  /** Story 12.4: carried-fix chip. null = no carry. */
  fixesApplied?: number | null; onResetFixes?: () => void;
  reportRef?: ReportRef | null;
  /** Live output meters for the stat line (LUFS / dBTP). */
  meters?: LiveMeters;
  playing?: boolean;
  activeModules?: number | null;
  bypassed?: boolean;
}) {
  const t = track;
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

export interface ListenRackPageProps {
  /** When set, the page plays the real uploaded audio for this version;
   *  omitted = mock rAF transport clock (demo route). */
  versionId?: string;
  track?: Track;
  /** Story 12.4 — the fix-rack carry-over preset id (?fixPreset=). */
  fixPreset?: string;
  reportRef?: ReportRef | null;
  /** Wave-3 E6.3 — retained for the route contract (no Stats rail in v2). */
  statsSource?: StatsSource | null;
  /** The playing version's song, for the "not analyzed yet" link. */
  songId?: string | undefined;
  /** Spec D3 — the newest analysis FOR THIS VERSION (VersionDto.latestJobId).
   *  Never the song's latest. */
  latestJobId?: string | null | undefined;
}

const LR_TABS = [
  ['rack', 'Rack', 'sliders'],
  ['visuals', 'Visuals', 'sparkle'],
  ['coach', 'Coach', 'robot'],
] as const;

export function ListenRackPage({ versionId, track: trackProp, fixPreset, reportRef = null, songId, latestJobId = null }: ListenRackPageProps) {
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

  const rs = useRackState(realAudio ? graph : null);
  const rsRef = useRef(rs);
  rsRef.current = rs;

  // ── Server-backed rack presets + draft ─────────────────────────────────────
  const currentChain = useMemo<Chain>(
    () => ({ order: rs.order, modules: rs.mod, masterBypass: rs.masterBypass }),
    [rs.order, rs.mod, rs.masterBypass],
  );
  const { fixesApplied, carryPhase, onResetCarriedFixes } = useFixCarryOver({
    versionId, fixPreset, realAudio, rsRef, currentChain,
  });
  const presetActions = useRackPresetActions({ versionId, realAudio, rs, currentChain });
  const stagePrefs = useStagePrefs();
  const findings = useListenFindings({ versionId: versionId ?? '', latestJobId, rs });

  // ── Pitch lane: a constant-tempo worklet shifter at the end of the master
  // path (NOT an insert). No buffer decode, no source swap — the media element
  // keeps driving playback, so position/duration bookkeeping is untouched. ──
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
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
      setPlaying(false);
    };
    pauseAll();
    mq.addEventListener('change', pauseAll);
    return () => mq.removeEventListener('change', pauseAll);
  }, [graph]);

  const posRef = useRef(position); posRef.current = position;

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

  // Pitch and tempo are INDEPENDENT: tempo is the media element's playbackRate,
  // and the worklet lane divides that back out of its shift ratio, so the
  // semitones you dial are what you hear at any speed (and vice versa).
  useEffect(() => {
    if (!realAudio) return;
    const a = audioRef.current;
    if (a) a.playbackRate = pitchEnabled ? pitchTempo : 1;
    graph.setPitchShift(pitchSemitones, pitchCents, pitchEnabled ? pitchTempo : 1);
    graph.setPitchShiftEnabled(pitchEnabled);
  }, [pitchSemitones, pitchCents, pitchTempo, pitchEnabled, realAudio, graph]);

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
    if (!a.paused) { a.pause(); setPlaying(false); return; }
    let played: Promise<void>;
    try {
      played = startPlayback();
    } catch (err) {
      toast.error(`Audio engine failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    played.catch((err: unknown) => {
      toast.error(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
      setPlaying(false);
    });
  }, [realAudio, startPlayback]);

  const seek = useCallback((t: number) => {
    if (!realAudio) { setPosition(t); return; }
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setPosition(t);
  }, [realAudio]);

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
  // localStorage read — memoized so it doesn't run on every single render.
  const queuedFixCount = useMemo(
    () => (versionId ? readListenFixes(versionId).length : 0), [versionId]);
  const coachCount = realAudio ? queuedFixCount : COACH_SUGGESTIONS.length;
  const onNote = useCallback((n: { id: string; t: number }) => {
    setActiveNote(n.id);
    seek(n.t);
  }, [seek]);

  return (
    <div className="rdx lr-shell" data-testid="listen-rack-page">
      <LightShow playing={playing} intensity={1} show gridHue={viz.gridHue} gridIntensity={viz.gridIntensity} />
      {/* zIndex 2: above the light-show canvas (z1), which itself sits above
          the body-portaled fullscreen viz stage (z0) so the floor grid shows
          through background effects. */}
      <div className="wrap lr-glass" data-density="dense" style={{ position: 'relative', zIndex: 2 }}>
        {/* Story 5.10: everything hides with the grid <1024 — the notice card
            takes its place instead. */}
        <div className="lr-desktop-only">
          {reportRef && (
            <Link to="/songs/$songId" params={{ songId: reportRef.songId }} className="backlink">
              <Icon name="back" size={14} />all versions
            </Link>
          )}
          <TrackHeader
            track={track}
            fixesApplied={fixesApplied} onResetFixes={onResetCarriedFixes}
            reportRef={reportRef} meters={meters} playing={playing}
            activeModules={activeCount} bypassed={rs.masterBypass}
          />

          <StageCardV2
            playing={playing}
            onPlay={togglePlay}
            position={position}
            duration={duration}
            onSeek={seek}
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
            activeModules={activeModuleManifests}
            trackName={track.name}
            trackSub={track.grade ? `grade ${track.grade}` : 'Listen session'}
            stageContent={stagePrefs.content}
            onStageContentChange={stagePrefs.setContent}
            bgViz={stagePrefs.bgViz}
            onBgVizChange={stagePrefs.setBgViz}
            {...(realAudio ? {
              findings: (
                <FindingsStage
                  findings={findings}
                  songId={songId}
                  durationSeconds={duration}
                  onSeek={seek}
                  carryPhase={carryPhase}
                  onClearPreset={onResetCarriedFixes}
                />
              ),
            } : {})}
          />

          {/* Sidebar lives OUTSIDE the tabbody so it reads as its own box beside
              the rack panel, not a column inside it. The rtabs strip stays
              stacked with the tabbody in the left column. */}
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
                    presets={presetActions.items}
                    onRecallPreset={presetActions.onRecall}
                    onSavePreset={presetActions.onSave}
                    onExport={presetActions.onExport}
                    onImport={presetActions.onImport}
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
                  <CoachTabV2
                    rs={rs} real={realAudio} versionId={versionId ?? null} reportRef={reportRef}
                    fixOverlay={realAudio ? findings.overlay : null} carryPhase={carryPhase}
                  />
                )}
              </div>
            </div>
            <NotesSidebar notes={track.notes} activeNote={activeNote} onNote={onNote} />
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

      <input ref={presetActions.importRef} type="file" accept="application/json,.json" onChange={(e) => { void presetActions.onImportFile(e); }} style={{ display: 'none' }} />

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />
      )}
    </div>
  );
}
