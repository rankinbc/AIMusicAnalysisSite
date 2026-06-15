import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { PreviewTools } from '../../features/listen/PreviewTools';
import { useAudioGraph } from '../../features/listen/useAudioGraph';
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

interface UiNote {
  id: string;
  timePct: number;
  body: string;
  pinned: boolean;
}

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

  const seek = (pct: number) => {
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
  };

  // ── Real-audio reactive state (rAF loop reads from AudioGraph) ──
  const [spectrumValues, setSpectrumValues] = useState<number[]>(
    () => Array.from({ length: SPECTRUM_BARS }, () => 0),
  );
  const [meters, setMeters] = useState({
    lufsShort: phase1?.lufs ?? -14,
    truePeakDb: phase1?.true_peak_db ?? phase1?.peak_dbfs ?? -1,
    correlation: phase1?.stereo_correlation ?? 0.6,
  });

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const draw = () => {
      const frame = graph.readFrame();
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
  const [noteInput, setNoteInput] = useState('');
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

  const handleAddNote = (text?: string) => {
    const t = (text ?? noteInput).trim();
    if (!t) return;
    createNote.mutate(
      { tSeconds: Math.max(0, position), text: t, pinned: false },
      {
        onSuccess: () => {
          setNoteInput('');
          toast.success('Note saved');
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not save note'),
      },
    );
  };

  const handleTogglePin = (id: string, currentlyPinned: boolean) => {
    patchNote.mutate({ noteId: id, body: { pinned: !currentlyPinned } });
  };

  const handleDeleteNote = (id: string) => {
    deleteNote.mutate(id, {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Could not delete note'),
    });
  };

  const [activeTool, setActiveTool] = useState<string | null>(null);
  useEffect(() => {
    if (verdict_id) toast.info('Preset handoff from Coach not yet wired.');
  }, [verdict_id]);

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

      <section className={`card ${s.hero}`}>
        <div className={s.heroVisual}>
          <div className={s.sectionOverlay}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: SECTION_COLORS[currentSection.type] }} />
            <span>{currentSection.name}</span>
          </div>
          <div className={s.liveStrip}>
            <LivePill label="LUFS-S" value={fmtNumber(meters.lufsShort, 1)} />
            <LivePill label="Peak" value={fmtNumber(meters.truePeakDb, 1)} />
            <LivePill label="Corr" value={fmtNumber(meters.correlation, 2)} />
          </div>
          <div className={s.spectrumWrap} aria-hidden="true">
            {spectrumValues.map((v, i) => (
              <div key={i} className={s.spectrumBar} style={{ height: `${Math.round(v * 92)}%` }} />
            ))}
          </div>
          <div className={s.freqGrid}>
            <span>20</span><span>60</span><span>200</span><span>500</span><span>1k</span><span>2k</span><span>5k</span><span>10k</span><span>20k</span>
          </div>
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

      <div className={s.belowGrid}>
        <div className={s.activityCol}>
          <section className={`card ${s.notesCard}`}>
            <header className={s.notesHd}>
              <span className={s.notesTitle}>Session notes</span>
              <Pill tone="violet">private to you</Pill>
            </header>
            {notes.length === 0 ? (
              <p className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                No notes yet. Use + Note @ time during playback.
              </p>
            ) : (
              <ul className={s.notesList}>
                {notes.map((n) => (
                  <li key={n.id} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
                    <button
                      type="button"
                      className={s.noteRow}
                      data-active={activeNote === n.id}
                      onClick={() => { setActiveNote(n.id); seek(n.timePct); }}
                      style={{ flex: 1 }}
                    >
                      <span className={s.noteIcon} data-pinned={n.pinned}>{n.pinned ? '★' : '·'}</span>
                      <div>
                        <div className={s.noteMeta}>
                          <span>@{formatTime(n.timePct * duration)}</span>
                          {n.pinned && <span style={{ color: 'var(--cyan)' }}>PINNED</span>}
                        </div>
                        <div className={s.noteBody}>{n.body}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={(e) => { e.stopPropagation(); handleTogglePin(n.id, n.pinned); }}
                      title={n.pinned ? 'Unpin' : 'Pin'}
                      style={{ alignSelf: 'stretch' }}
                    >
                      {n.pinned ? '☆' : '★'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={(e) => { e.stopPropagation(); handleDeleteNote(n.id); }}
                      title="Delete note"
                      style={{ alignSelf: 'stretch', color: 'var(--red)' }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={s.newNoteRow}>
              <span className={s.noteIcon}>+</span>
              <input
                className={s.newNoteInput}
                placeholder="What did you hear?"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
              />
              <span className={s.newNoteTime}>@{formatTime(position)}</span>
              <button
                type="button"
                className="btn primary sm"
                onClick={() => handleAddNote()}
                disabled={!noteInput.trim() || createNote.isPending}
              >
                Save
              </button>
            </div>
          </section>

          <section className={`card ${s.contextCard}`}>
            <header className={s.notesHd}>
              <span className={s.notesTitle}>Track context</span>
              <span className="label">from analysis</span>
            </header>
            <div className={s.contextGrid}>
              <ContextStat label="Genre" value={phase2?.genre ? fmtGenre(phase2.genre) : '—'} />
              <ContextStat label="BPM" value={fmtBpm(phase1?.bpm)} />
              <ContextStat label="Duration" value={duration > 0 ? formatTime(duration) : '—'} />
              <ContextStat label="Key" value={phase1?.detected_key ?? '—'} />
              <ContextStat label="LUFS" value={phase1?.lufs != null ? fmtNumber(phase1.lufs, 1) : '—'} />
              <ContextStat label="Mono" value={phase1?.mono_compatibility != null ? `${Math.round(phase1.mono_compatibility * 100)}%` : '—'} />
            </div>
          </section>
        </div>

        <aside className={s.meterRail}>
          <section className={`card ${s.meterCard}`}>
            <header className={s.cardHd}>
              <span className={s.cardTitle}>Live meters</span>
              <Pill tone={playing ? 'cyan' : 'default'}>{playing ? 'live' : 'idle'}</Pill>
            </header>
            <MeterRow
              label="Short LUFS"
              value={fmtNumber(meters.lufsShort, 1)}
              fillPct={Math.max(0, Math.min(1, (meters.lufsShort + 30) / 30))}
              color="var(--cyan)"
            />
            <MeterRow
              label="True peak"
              value={fmtNumber(meters.truePeakDb, 1)}
              fillPct={Math.max(0, Math.min(1, (meters.truePeakDb + 12) / 12))}
              color={meters.truePeakDb > -1 ? 'var(--orange)' : 'var(--cyan)'}
            />
            <MeterRow
              label="Correlation"
              value={fmtNumber(meters.correlation, 2)}
              fillPct={(meters.correlation + 1) / 2}
              color={meters.correlation < 0 ? 'var(--red)' : meters.correlation < 0.3 ? 'var(--yellow)' : 'var(--cyan)'}
            />
            <MeterRow
              label="Width"
              value={phase1?.stereo_width != null ? `${Math.round(phase1.stereo_width * 100)}%` : '—'}
              fillPct={phase1?.stereo_width ?? 0.5}
              color="var(--blue)"
            />
          </section>

          <section className={`card ${s.meterCard}`}>
            <header className={s.cardHd}>
              <span className={s.cardTitle}>Frequency tilt</span>
            </header>
            <div className={s.miniSpectrum} aria-hidden="true">
              {spectrumValues.slice(0, 28).map((v, i) => (
                <div key={i} style={{ height: `${Math.round(v * 90 + 10)}%` }} />
              ))}
            </div>
            <div className={s.miniLabels}>
              <span>20Hz</span><span>1kHz</span><span>20kHz</span>
            </div>
          </section>
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

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.contextStat}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
    </div>
  );
}

function MeterRow({
  label,
  value,
  fillPct,
  color,
}: {
  label: string;
  value: string;
  fillPct: number;
  color: string;
}) {
  return (
    <div className={s.meterRow}>
      <span className={s.meterRowLabel}>{label}</span>
      <span className={s.meterRowValue}>{value}</span>
      <div className={s.meterBar}>
        <div
          className={s.meterFill}
          style={{ width: `${Math.max(0, Math.min(1, fillPct)) * 100}%`, background: color }}
        />
      </div>
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
