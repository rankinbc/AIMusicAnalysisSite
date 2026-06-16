import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { getAccessToken } from '../../api/fetcher';
import {
  useCreateNote,
  useDeleteNote,
  useJobResults,
  useNotes,
  usePatchNote,
  useSong,
  useStemProposals,
  useVersion,
} from '../../api/hooks';
import {
  isFinalJson,
  type FinalJson,
  type Phase1Data,
  type Phase2Data,
  type Phase7Data,
} from '../../api/types';
import {
  LOOP_DEFAULT,
  PITCH_PANEL_DEFAULT,
  type LoopState,
  type PitchPanelState,
} from '../../features/listen/loop';
import { IssuesPanel } from '../../features/listen/IssuesPanel';
import { buildMeterCells } from '../../features/listen/meters';
import { MeterModule } from '../../features/listen/MeterModule';
import { NotesPanel, type UiNote } from '../../features/listen/NotesPanel';
import { PreviewTools } from '../../features/listen/PreviewTools';
import { RightRail } from '../../features/listen/RightRail';
import { StageDisplay, type VizState } from '../../features/listen/StageDisplay';
import { Fireworks, type FireworksHandle } from '../../features/listen/Fireworks';
import { DEFAULT_VIZ_STATE, VizControls } from '../../features/listen/VizControls';
import type { StageId } from '../../features/listen/stageRegistry';
import { buildRailTabs } from '../../features/listen/tabRegistry';
import { useAudioGraph, type AudioFrame } from '../../features/listen/useAudioGraph';
import { StemDeck, type DeckStem } from '../../features/listen/StemDeck';
import { useStemEngine } from '../../features/listen/useStemEngine';
import { fmtBpm, fmtGenre, fmtNumber } from '../../features/results/helpers/format';
import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { Pill } from '../../ui/Pill';
import s from './listen.module.css';

const search = z.object({
  verdict_id: z.string().optional(),
});

export const Route = createFileRoute('/_app/listen/$versionId')({
  validateSearch: search,
  component: ListenPage,
});

const SPECTRUM_BARS = 56;
const WAVEFORM_BARS = 240;

const SECTION_COLORS: Record<string, string> = {
  intro: 'rgba(0, 229, 176, 0.32)',
  buildup: 'rgba(167, 139, 250, 0.42)',
  drop: 'rgba(251, 146, 60, 0.45)',
  chorus: 'rgba(251, 146, 60, 0.45)',
  verse: 'rgba(96, 165, 250, 0.32)',
  bridge: 'rgba(96, 165, 250, 0.32)',
  breakdown: 'rgba(96, 165, 250, 0.35)',
  outro: 'rgba(255, 255, 255, 0.18)',
};

interface Section {
  name: string;
  /** Lower-cased section-type key. Falls through to the neutral color when
   *  not in SECTION_COLORS (e.g. unknown phase 7 labels). */
  type: string;
  startPct: number;
  endPct: number;
}

// Fallback used when phase 7 didn't produce sections — e.g. ambient mixes
// or skipped/failed phase. Keeps the scrubber visually meaningful instead
// of showing one flat empty bar.
const FALLBACK_SECTIONS: Section[] = [
  { name: 'Intro', type: 'intro', startPct: 0, endPct: 0.12 },
  { name: 'Buildup', type: 'buildup', startPct: 0.12, endPct: 0.36 },
  { name: 'Drop', type: 'drop', startPct: 0.36, endPct: 0.62 },
  { name: 'Breakdown', type: 'breakdown', startPct: 0.62, endPct: 0.84 },
  { name: 'Outro', type: 'outro', startPct: 0.84, endPct: 1 },
];

function sectionsFromPhase7(
  phase7: Phase7Data | undefined,
  fallbackDuration: number,
): Section[] {
  const scores = phase7?.section_scores;
  if (!scores || scores.length === 0) return FALLBACK_SECTIONS;
  const total =
    phase7?.total_duration && phase7.total_duration > 0
      ? phase7.total_duration
      : fallbackDuration > 0
        ? fallbackDuration
        : scores[scores.length - 1]?.end_time ?? 0;
  if (!total || total <= 0) return FALLBACK_SECTIONS;
  return scores.map((sec) => ({
    name: sec.section_type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    type: sec.section_type.toLowerCase(),
    startPct: Math.max(0, Math.min(1, sec.start_time / total)),
    endPct: Math.max(0, Math.min(1, sec.end_time / total)),
  }));
}


// Neutral frame fed to buildMeterCells before the first rAF frame lands (or
// while paused). Mirrors the AudioFrame shape from useAudioGraph.
const ZERO_FRAME: AudioFrame = {
  fftBins: new Float32Array(0),
  bandAverages: new Float32Array(0),
  rmsDb: -Infinity,
  lufsShort: -Infinity,
  truePeakDb: -Infinity,
  correlation: 0,
  scopeL: new Float32Array(0),
  scopeR: new Float32Array(0),
};

function ListenPage() {
  const { versionId } = Route.useParams();
  const { verdict_id } = Route.useSearch();
  const { data: version, isLoading: versionLoading, error: versionError } = useVersion(versionId);
  const { data: song } = useSong(version?.songId ?? '');
  const latestJobId = song?.latestResult?.jobId;
  const { data: results } = useJobResults(latestJobId ?? '', Boolean(latestJobId));

  const fj: FinalJson = isFinalJson(results?.finalJson) ? results.finalJson : {};
  const phase1 = pickPhase<Phase1Data>(fj, 1);
  const phase2 = pickPhase<Phase2Data>(fj, 2);
  const phase7 = pickPhase<Phase7Data>(fj, 7);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useAudioGraph(audioRef);

  // ── Visualizer (StageDisplay) state ──
  const [stage, setStage] = useState<StageId>('eq');
  const [viz, setViz] = useState<VizState>(DEFAULT_VIZ_STATE);
  const fireworksRef = useRef<FireworksHandle | null>(null);
  const patchViz = useCallback((p: Partial<VizState>) => setViz((v) => ({ ...v, ...p })), []);

  // Half-beat pulse drives the visualizer's --beat CSS var (~0.484s @124 BPM).
  const bpm = Math.max(1, phase2?.bpm ?? phase1?.bpm ?? 124);
  const beatSeconds = 60 / bpm / 2;

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number>(phase1?.duration_seconds ?? 0);
  const [volume, setVolume] = useState(0.8);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState<LoopState>(LOOP_DEFAULT);
  const [pitch, setPitch] = useState<PitchPanelState>(PITCH_PANEL_DEFAULT);
  // True while the audio buffer source (pitch lane) is driving playback
  // instead of the MediaElement. Owned by the page so transport ops know
  // which lane to operate on.
  const pitchModeRef = useRef(false);

  // ── Stem deck (DJ tab) ── real per-stem audio, mutually exclusive with the
  // single-track graph. Backed by the existing stems pipeline (GetStems +
  // /stems/{stemId}/audio); stems are id-keyed (per-stem mode allows multiple
  // stems per role).
  const { data: stemProposals, isLoading: stemsLoading } = useStemProposals(
    versionId,
    Boolean(versionId),
  );
  const deckStems = useMemo<DeckStem[]>(
    () =>
      (stemProposals?.stems ?? []).map((st) => ({
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
  const stopStems = () => {
    setStemPlaying((prev) => {
      if (prev) stemEngine.pause();
      return false;
    });
  };

  // Throttle gate for the rail's meter frame so the rail subtree doesn't
  // reconcile at the 60fps spectrum cadence. Updated to ~12 Hz in the draw loop.
  const lastMeterTsRef = useRef(0);

  const audioUrl = useMemo(() => {
    if (!versionId) return null;
    const token = getAccessToken();
    if (!token) return null;
    return `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}`;
  }, [versionId]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    const onDuration = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      toast.error('Could not load audio. Try refreshing.');
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDuration);
    a.addEventListener('durationchange', onDuration);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDuration);
      a.removeEventListener('durationchange', onDuration);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onError);
    };
  }, [audioUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = volume;
  }, [volume]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = rate;
  }, [rate]);

  // ── Pitch lane wiring ──
  // The audio graph owns a BufferSource lane; when pitch is enabled the page
  // pauses the MediaElement and drives playback via the graph instead. The
  // <audio> tag continues to own duration + the visible URL.

  const handlePitchChange = (next: PitchPanelState) => {
    setPitch(next);
  };

  // Apply detune to the live BufferSource whenever semitones/cents change.
  useEffect(() => {
    if (pitch.enabled) graph.setPitchDetune(pitch.semitones, pitch.cents);
  }, [pitch.semitones, pitch.cents, pitch.enabled, graph]);

  // Enter/exit pitch mode in response to the toggle. Decoding can take a few
  // seconds on long FLACs — we surface a "DECODING…" state on the toggle.
  useEffect(() => {
    let cancelled = false;
    const a = audioRef.current;
    if (!a || !audioUrl) return undefined;

    if (pitch.enabled && !pitchModeRef.current) {
      const wasPlaying = !a.paused;
      const startedAt = a.currentTime;
      a.pause();
      setPlaying(false);
      try {
        graph.ensureContext();
      } catch (err) {
        toast.error(`Audio engine failed: ${err instanceof Error ? err.message : err}`);
        setPitch({ ...pitch, enabled: false });
        return undefined;
      }
      setPitch((p) => ({ ...p, decoding: true, decodeError: null }));
      graph
        .enterPitchMode(audioUrl, startedAt)
        .then(() => {
          if (cancelled) return;
          pitchModeRef.current = true;
          setPitch((p) => ({ ...p, decoding: false }));
          // Once decode is done, switch the page's duration display over to
          // the BufferSource duration (sample-accurate, doesn't get reset
          // by token rotations).
          const bufDur = graph.pitchDuration();
          if (bufDur > 0) setDuration(bufDur);
          setPosition(startedAt);
          graph.setPitchDetune(pitch.semitones, pitch.cents);
          if (wasPlaying) {
            graph.pitchResume();
            setPlaying(true);
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setPitch((p) => ({ ...p, decoding: false, enabled: false, decodeError: message }));
          toast.error(`Pitch decode failed: ${message}`);
        });
    } else if (!pitch.enabled && pitchModeRef.current) {
      const wasPlaying = graph.pitchPlaying();
      const pos = graph.exitPitchMode();
      pitchModeRef.current = false;
      a.currentTime = pos;
      setPosition(pos);
      if (wasPlaying) {
        a.play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      }
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch.enabled, audioUrl, graph]);

  // Drive position updates while pitch mode is playing — BufferSource has no
  // timeupdate event, so we tick on rAF using graph.pitchCurrentTime().
  useEffect(() => {
    if (!pitch.enabled || !pitchModeRef.current) return undefined;
    let raf = 0;
    const tick = () => {
      // Always read the current playhead — even paused — so the timecode
      // doesn't get stuck showing 0:00 when the MediaElement timeupdate
      // handler stops firing.
      setPosition(graph.pitchCurrentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pitch.enabled, graph]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    // Pitch-mode path uses the BufferSource lane.
    if (pitch.enabled && pitchModeRef.current) {
      if (graph.pitchPlaying()) {
        graph.pitchPause();
        setPlaying(false);
      } else {
        try {
          graph.ensureContext();
        } catch (err) {
          toast.error(`Audio engine failed: ${err instanceof Error ? err.message : err}`);
          return;
        }
        stopStems();
        graph.pitchResume();
        setPlaying(true);
      }
      return;
    }
    // Default path: MediaElement.
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    stopStems();
    try {
      graph.ensureContext();
    } catch (err) {
      toast.error(`Audio engine failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    a.play()
      .then(() => setPlaying(true))
      .catch((err) => {
        toast.error(`Playback failed: ${err.message ?? err}`);
        setPlaying(false);
      });
  };

  const seek = useCallback(
    (pct: number) => {
      const dur = pitch.enabled && pitchModeRef.current
        ? graph.pitchDuration()
        : Number.isFinite(audioRef.current?.duration ?? NaN)
          ? audioRef.current!.duration
          : duration;
      const t = Math.max(0, Math.min(1, pct)) * dur;
      if (pitch.enabled && pitchModeRef.current) {
        graph.pitchSeek(t);
        setPosition(t);
        return;
      }
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = t;
      setPosition(t);
    },
    [pitch.enabled, graph, duration],
  );

  // ── Real-audio reactive state (rAF loop reads from AudioGraph) ──
  const [spectrumValues, setSpectrumValues] = useState<number[]>(
    () => Array.from({ length: SPECTRUM_BARS }, () => 0),
  );
  const [meters, setMeters] = useState({
    lufsShort: phase1?.lufs ?? -14,
    truePeakDb: phase1?.true_peak_db ?? phase1?.peak_dbfs ?? -1,
    correlation: phase1?.stereo_correlation ?? 0.6,
  });
  // Full live frame captured for the rail's Meters tab (buildMeterCells).
  const [meterFrame, setMeterFrame] = useState<AudioFrame | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const draw = () => {
      const frame = graph.readFrame();
      const nowMs = performance.now();
      if (nowMs - lastMeterTsRef.current >= 80) {
        lastMeterTsRef.current = nowMs;
        setMeterFrame(frame);
      }
      if (frame.fftBins.length > 0) {
        const bins = frame.fftBins;
        // Down-sample the FFT to SPECTRUM_BARS bars using log-spaced bins so
        // bass doesn't dominate visually.
        const next = new Array<number>(SPECTRUM_BARS);
        const minLog = Math.log10(1);
        const maxLog = Math.log10(bins.length);
        for (let i = 0; i < SPECTRUM_BARS; i += 1) {
          const lo = Math.floor(10 ** (minLog + (i / SPECTRUM_BARS) * (maxLog - minLog)));
          const hi = Math.max(
            lo + 1,
            Math.floor(10 ** (minLog + ((i + 1) / SPECTRUM_BARS) * (maxLog - minLog))),
          );
          let sum = 0;
          for (let j = lo; j < hi && j < bins.length; j += 1) sum += bins[j];
          next[i] = Math.min(1, (sum / Math.max(1, hi - lo)) * 1.4);
        }
        setSpectrumValues(next);
        setMeters({
          lufsShort: frame.lufsShort,
          truePeakDb: frame.truePeakDb,
          correlation: frame.correlation,
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, graph]);

  // Real section layout from phase 7 (or fallback when phase 7 is missing).
  const sections = useMemo(
    () => sectionsFromPhase7(phase7, duration),
    [phase7, duration],
  );

  // Procedural waveform for the scrubber — visual scaffolding, NOT the real
  // audio buffer. Real peaks require a server-side peaks file or client-side
  // OfflineAudioContext decode (handled in a separate slice). We bias the
  // amplitude by section type so drops/choruses read louder than intros.
  const waveform = useMemo(() => {
    return Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      const pct = i / WAVEFORM_BARS;
      const sec = sections.find((s) => pct >= s.startPct && pct < s.endPct);
      const amp =
        sec?.type === 'drop' || sec?.type === 'chorus'
          ? 0.95
          : sec?.type === 'buildup'
            ? 0.7
            : sec?.type === 'breakdown'
              ? 0.55
              : 0.4;
      const noise = Math.sin(i * 0.7) * 0.3 + Math.sin(i * 2.3) * 0.18 + 0.5;
      return amp * (0.4 + noise * 0.6);
    });
  }, [sections]);

  const { data: serverNotes } = useNotes(versionId);
  const createNote = useCreateNote(versionId);
  const patchNote = usePatchNote(versionId);
  const deleteNote = useDeleteNote(versionId);
  const [activeNote, setActiveNote] = useState<string | null>(null);

  // Project the server's absolute-time notes into the scrubber's pct-of-duration
  // shape. Falls back to 0% when duration is still loading so newly created
  // notes don't jump position once metadata resolves.
  const notes: UiNote[] = useMemo(() => {
    const d = duration > 0 ? duration : 1;
    return (serverNotes ?? []).map((n) => ({
      id: n.id,
      timePct: Math.max(0, Math.min(1, n.tSeconds / d)),
      body: n.text,
      pinned: n.pinned,
    }));
  }, [serverNotes, duration]);

  const handleAddNote = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      createNote.mutate(
        { tSeconds: Math.max(0, position), text: t, pinned: false },
        {
          onSuccess: () => {
            toast.success('Note saved');
          },
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : 'Could not save note'),
        },
      );
    },
    [createNote, position],
  );

  const handleTogglePin = useCallback(
    (id: string, currentlyPinned: boolean) => {
      patchNote.mutate({ noteId: id, body: { pinned: !currentlyPinned } });
    },
    [patchNote],
  );

  const handleDeleteNote = useCallback(
    (id: string) => {
      deleteNote.mutate(id, {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not delete note'),
      });
    },
    [deleteNote],
  );

  // Seek to a note via the same `seek(pct)` path the scrubber uses (handles
  // both the MediaElement and pitch-lane cases).
  const handleSeekToNote = useCallback(
    (id: string) => {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      setActiveNote(id);
      seek(n.timePct);
    },
    [notes, seek],
  );

  const [activeTool, setActiveTool] = useState<string | null>(null);
  useEffect(() => {
    if (verdict_id) toast.info('Preset handoff from Coach not yet wired.');
  }, [verdict_id]);

  // ── Right rail (Meters · Issues · DJ · Notes) ──
  // Each panel node + the tab set is memoized so the 60fps spectrum re-renders
  // don't rebuild the rail subtree. meterFrame is throttled to ~12 Hz, so the
  // meters panel reconciles at that lower cadence. GR is null until a later
  // plan wires live compressor reduction.
  const meterCells = useMemo(
    () => buildMeterCells({ frame: meterFrame ?? ZERO_FRAME, phase1: phase1 ?? {}, grReductionDb: null }),
    [meterFrame, phase1],
  );
  // NotesPanel only uses position for the "@time" label on its add-row, so we
  // pass whole-second precision to avoid rebuilding it on every position tick
  // (position updates at 60fps while pitch mode is active).
  const notePosition = Math.floor(position);
  const metersNode = useMemo(() => <MeterModule cells={meterCells} variant="panel" />, [meterCells]);
  const issuesNode = useMemo(() => <IssuesPanel jobId={latestJobId} />, [latestJobId]);
  const djNode = useMemo(
    () => (
      <>
        <StemDeck
          stems={deckStems}
          isLoading={stemsLoading}
          stemUrl={stemUrl}
          engine={stemEngine}
          playing={stemPlaying}
          onActivate={activateStemMode}
          onPlayPause={setStemPlaying}
        />
        <VizControls
          viz={viz}
          onChange={patchViz}
          onLaunchFireworks={() => fireworksRef.current?.launch()}
        />
      </>
    ),
    [deckStems, stemsLoading, stemUrl, stemEngine, stemPlaying, activateStemMode, viz, patchViz],
  );
  const notesNode = useMemo(
    () => (
      <NotesPanel
        notes={notes}
        duration={duration}
        position={notePosition}
        activeNote={activeNote}
        pending={createNote.isPending}
        onSeekToNote={handleSeekToNote}
        onAdd={handleAddNote}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteNote}
      />
    ),
    [notes, duration, notePosition, activeNote, createNote.isPending, handleSeekToNote, handleAddNote, handleTogglePin, handleDeleteNote],
  );
  const railTabs = useMemo(
    () => buildRailTabs({ meters: metersNode, issues: issuesNode, dj: djNode, notes: notesNode }),
    [metersNode, issuesNode, djNode, notesNode],
  );

  // ── StageDisplay slot nodes ──
  // Memoized so the 60fps spectrum re-renders (spectrumValues state) don't
  // rebuild the meter overlay, the fireworks canvas, or the info content.
  const meterOverlayNode = useMemo(
    () => <MeterModule cells={meterCells} variant="overlay" defaultCollapsed />,
    [meterCells],
  );
  const fireworksNode = useMemo(() => <Fireworks ref={fireworksRef} />, []);
  const infoContentNode = useMemo(
    () => (
      <>
        <h2>{song?.name ?? 'Untitled'}</h2>
        <p>{version?.label ?? (version ? `v${version.versionNumber}` : '')}</p>
      </>
    ),
    [song?.name, version],
  );

  if (versionLoading) {
    return (
      <div className={s.page}>
        <p className={`mono ${s.status}`}>Loading…</p>
      </div>
    );
  }
  if (versionError || !version) {
    return (
      <div className={s.page}>
        <Link to="/library" className={s.backLink}>← Library</Link>
        <p className={s.error}>Version not found.</p>
      </div>
    );
  }

  const trackName = song?.name ?? `Version ${version.versionNumber}`;
  const hue = song?.id ? hueFromId(song.id) : 168;
  const positionPct = duration > 0 ? position / duration : 0;
  const currentSection =
    sections.find((sec) => positionPct >= sec.startPct && positionPct < sec.endPct) ??
    sections[0];

  return (
    <div className={s.page}>
      <Link to="/library" className={s.backLink}>← Library</Link>

      <section className={`card ${s.trackHeader}`}>
        <CoverArt hue={hue} size="md" />
        <div className={s.titleBlock}>
          <div className={s.nowPlayingRow}>
            <span className="dot pulse-soft" />
            <span>Now playing</span>
            {version.label && <span style={{ color: 'var(--muted)' }}>· {version.label}</span>}
          </div>
          <div className={s.trackName}>{trackName}</div>
          <div className={s.pillRow}>
            {phase2?.genre && <Pill tone="cyan">{fmtGenre(phase2.genre)}</Pill>}
            {phase1?.bpm != null && <Pill><span className="mono">{fmtBpm(phase1.bpm)}</span> BPM</Pill>}
            {phase1?.detected_key && <Pill><span className="mono">{phase1.detected_key}</span></Pill>}
            {phase1?.lufs != null && <Pill><span className="mono">{fmtNumber(phase1.lufs, 1)}</span> LUFS</Pill>}
            <Pill><span className="mono">v{version.versionNumber}</span></Pill>
          </div>
        </div>
        <div className={s.headerRight}>
          {song && latestJobId && (
            <Link
              to="/songs/$songId/results/$jobId"
              params={{ songId: song.id, jobId: latestJobId }}
              className="btn sm"
            >
              View Report →
            </Link>
          )}
        </div>
      </section>

      <div className={s.mainGrid}>
        <div className={s.centerCol}>
          <section className={`card ${s.hero}`}>
            <StageDisplay
              stage={stage}
              onStageChange={setStage}
              spectrumValues={spectrumValues}
              beatSeconds={beatSeconds}
              viz={viz}
              meterOverlay={meterOverlayNode}
              fireworks={fireworksNode}
              infoContent={infoContentNode}
            />

            <div className={s.liveStrip}>
              <LivePill label="Section" value={currentSection.name} />
              <LivePill label="LUFS-S" value={fmtNumber(meters.lufsShort, 1)} />
              <LivePill label="Peak" value={fmtNumber(meters.truePeakDb, 1)} />
              <LivePill label="Corr" value={fmtNumber(meters.correlation, 2)} />
            </div>

            <div className={s.heroTransport}>
              <Scrubber
                sections={sections}
                waveform={waveform}
                positionPct={positionPct}
                duration={duration}
                notes={notes}
                loop={loop}
                onSeek={seek}
                onNoteClick={(id) => setActiveNote(id)}
                activeNote={activeNote}
              />
              <div className={s.transportRow}>
                <button
                  type="button"
                  className={s.playBig}
                  data-playing={playing}
                  onClick={togglePlay}
                  disabled={!audioUrl}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? '⏸' : '▶'}
                </button>
                <button type="button" className={s.transportBtn} onClick={() => seek(Math.max(0, positionPct - 0.05))} aria-label="Back 5%">⏮</button>
                <button type="button" className={s.transportBtn} onClick={() => seek(Math.min(1, positionPct + 0.05))} aria-label="Forward 5%">⏭</button>
                <span className={s.timecode}>{formatTime(position)} / {formatTime(duration)}</span>
                <SpeedDial value={rate} onChange={setRate} />
                <div className={s.volumeWrap}>
                  <span className={s.volumeIcon}>VOL</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className={s.volumeSlider}
                    aria-label="Volume"
                  />
                  <span className={s.volumeIcon}>{Math.round(volume * 100)}</span>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => handleAddNote(`Note @ ${formatTime(position)}`)}
                  disabled={!duration || createNote.isPending}
                >
                  + Note @ time
                </button>
              </div>
            </div>
          </section>

          <PreviewTools
            graph={graph}
            activeTool={activeTool}
            onActiveToolChange={setActiveTool}
            loop={loop}
            onLoopChange={setLoop}
            audioRef={audioRef}
            currentTime={position}
            duration={duration}
            pitch={pitch}
            onPitchChange={handlePitchChange}
          />
        </div>

        <aside className={s.railCol}>
          <RightRail tabs={railTabs} defaultTab="meters" />
        </aside>
      </div>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />
      )}
    </div>
  );
}

interface ScrubberProps {
  sections: Section[];
  waveform: number[];
  positionPct: number;
  duration: number;
  notes: UiNote[];
  loop: LoopState;
  onSeek: (pct: number) => void;
  onNoteClick: (id: string) => void;
  activeNote: string | null;
}

function Scrubber({
  sections,
  waveform,
  positionPct,
  duration,
  notes,
  loop,
  onSeek,
  onNoteClick,
  activeNote,
}: ScrubberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek((e.clientX - rect.left) / rect.width);
  };
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverPct((e.clientX - rect.left) / rect.width);
  };

  const loopInPct = loop.inSec != null && duration > 0 ? loop.inSec / duration : null;
  const loopOutPct = loop.outSec != null && duration > 0 ? loop.outSec / duration : null;

  return (
    <div className={s.scrubber}>
      <div className={s.scrubberRibbon} aria-hidden="true">
        {sections.map((sec) => (
          <div
            key={sec.name}
            className={s.ribbonSection}
            style={{ flex: sec.endPct - sec.startPct, background: SECTION_COLORS[sec.type] }}
          >
            {sec.name}
          </div>
        ))}
        <div className={s.ribbonPlayhead} style={{ left: `${positionPct * 100}%` }} />
      </div>
      <div
        ref={ref}
        className={s.waveform}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverPct(null)}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(positionPct * 100)}
        tabIndex={0}
      >
        {waveform.map((v, i) => (
          <div
            key={i}
            className={s.waveBar}
            data-played={i / waveform.length <= positionPct}
            style={{ height: `${v * 100}%` }}
          />
        ))}
        {loopInPct != null && loopOutPct != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${loopInPct * 100}%`,
              width: `${(loopOutPct - loopInPct) * 100}%`,
              background: 'rgba(167, 139, 250, 0.18)',
              border: '1px solid var(--violet)',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          />
        )}
        {hoverPct != null && duration > 0 && (
          <div className={s.waveTooltip} style={{ left: `${hoverPct * 100}%` }}>
            {formatTime(hoverPct * duration)}
          </div>
        )}
      </div>
      <div className={s.notesRow}>
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={s.noteMarker}
            data-pinned={n.pinned}
            style={{ left: `${n.timePct * 100}%`, opacity: activeNote === n.id ? 1 : 0.7 }}
            onClick={() => onNoteClick(n.id)}
            title={n.body}
          >
            {n.pinned ? '★' : '·'}
          </button>
        ))}
      </div>
    </div>
  );
}

function SpeedDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = [0.75, 1, 1.25, 1.5];
  return (
    <div className={s.speedDial} role="group" aria-label="Playback speed">
      {options.map((o) => (
        <button key={o} type="button" data-active={value === o} onClick={() => onChange(o)}>
          {o}×
        </button>
      ))}
    </div>
  );
}

function LivePill({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.livePill}>
      <span className={s.livePillLabel}>{label}</span>
      <span className={s.livePillValue}>{value}</span>
    </div>
  );
}

function pickPhase<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
