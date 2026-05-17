import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { getAccessToken } from '../../api/fetcher';
import { useJobResults, useSong, useVersion } from '../../api/hooks';
import {
  isFinalJson,
  type FinalJson,
  type Phase1Data,
  type Phase2Data,
} from '../../api/types';
import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { GradePill } from '../../ui/GradePill';
import { Pill } from '../../ui/Pill';
import { fmtBpm, fmtGenre, fmtNumber } from '../../features/results/helpers/format';
import s from './listen.module.css';

// /listen/$versionId?verdict_id=<id>
// When verdict_id is present, Listen pre-applies that verdict's fix preset
// to the ToolsRail. (Visual hook only — preset state lives client-side for v1.)
const search = z.object({
  verdict_id: z.string().optional(),
});

export const Route = createFileRoute('/_app/listen/$versionId')({
  validateSearch: search,
  component: ListenPage,
});

const SPECTRUM_BARS = 56;
const WAVEFORM_BARS = 240;

interface PreviewTool {
  id: string;
  label: string;
  glyph: string;
  sub: string;
  tier: 'v1' | 'v2';
  accent: string;
  description: string;
}

const PREVIEW_TOOLS: PreviewTool[] = [
  { id: 'eq', label: 'EQ Preview', glyph: 'EQ', sub: '8-band parametric', tier: 'v1', accent: '#00e5b0', description: 'Sweep an inline 8-band parametric EQ over the playback bus.' },
  { id: 'comp', label: 'Compressor', glyph: '◐', sub: 'Threshold · ratio', tier: 'v1', accent: '#fbbf24', description: 'Apply a single-band compressor to taste — no automation.' },
  { id: 'sat', label: 'Saturation', glyph: '~', sub: 'Tanh drive', tier: 'v1', accent: '#fb923c', description: 'Soft-clipping waveshaper — drive the master without clipping the ceiling.' },
  { id: 'ms', label: 'M/S Width', glyph: '◭', sub: 'Mid/Side balance', tier: 'v1', accent: '#60a5fa', description: 'Adjust the stereo width by splitting mid and side channels.' },
  { id: 'lim', label: 'Limiter', glyph: '|', sub: 'Brickwall', tier: 'v2', accent: '#f43f5e', description: 'True-peak limiter — coming in v2.' },
  { id: 'pitch', label: 'Pitch', glyph: '#', sub: 'Cents · semitones', tier: 'v2', accent: '#a78bfa', description: 'Real-time pitch shift — coming in v2.' },
  { id: 'loop', label: 'Loop', glyph: '⟲', sub: 'Section loop', tier: 'v1', accent: '#a78bfa', description: 'Lock playback to a bar range for AB-testing fixes.' },
  { id: 'scope', label: 'Scope', glyph: '◎', sub: 'Goniometer · phase', tier: 'v1', accent: '#34d399', description: 'Real-time correlation goniometer — visualize phase.' },
];

const SECTION_COLORS: Record<string, string> = {
  intro: 'rgba(0, 229, 176, 0.32)',
  buildup: 'rgba(167, 139, 250, 0.42)',
  drop: 'rgba(251, 146, 60, 0.45)',
  breakdown: 'rgba(96, 165, 250, 0.35)',
  outro: 'rgba(255, 255, 255, 0.18)',
};

interface StubSection {
  name: string;
  type: keyof typeof SECTION_COLORS;
  startPct: number;
  endPct: number;
}

const STUB_SECTIONS: StubSection[] = [
  { name: 'Intro', type: 'intro', startPct: 0, endPct: 0.12 },
  { name: 'Buildup', type: 'buildup', startPct: 0.12, endPct: 0.36 },
  { name: 'Drop', type: 'drop', startPct: 0.36, endPct: 0.62 },
  { name: 'Breakdown', type: 'breakdown', startPct: 0.62, endPct: 0.84 },
  { name: 'Outro', type: 'outro', startPct: 0.84, endPct: 1 },
];

interface StubNote {
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

  // ── Audio element + state ────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number>(phase1?.duration_seconds ?? 0);
  const [volume, setVolume] = useState(0.8);
  const [rate, setRate] = useState(1);

  const audioUrl = useMemo(() => {
    if (!versionId) return null;
    const token = getAccessToken();
    if (!token) return null;
    return `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}`;
  }, [versionId]);

  // Attach event listeners when the audio element mounts.
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
    if (!a) return;
    a.volume = volume;
  }, [volume]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = rate;
  }, [rate]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play()
        .then(() => setPlaying(true))
        .catch((err) => {
          toast.error(`Playback failed: ${err.message ?? err}`);
          setPlaying(false);
        });
    }
  };

  const seek = (pct: number) => {
    const a = audioRef.current;
    if (!a) return;
    const t = Math.max(0, Math.min(1, pct)) * (Number.isFinite(a.duration) ? a.duration : duration);
    a.currentTime = t;
    setPosition(t);
  };

  // ── Procedural visualizer (rAF) — replace with AnalyserNode in v2 ──
  const [spectrumValues, setSpectrumValues] = useState<number[]>(
    () => Array.from({ length: SPECTRUM_BARS }, () => 0.2),
  );
  useEffect(() => {
    if (!playing) {
      setSpectrumValues((prev) => prev.map((v) => v * 0.7));
      return;
    }
    let raf = 0;
    const t0 = performance.now() / 1000;
    function frame() {
      const t = performance.now() / 1000 - t0;
      setSpectrumValues(
        Array.from({ length: SPECTRUM_BARS }, (_, i) => {
          const base = 1 - i / SPECTRUM_BARS;
          const wave = 0.5 + Math.sin(t * 4 + i * 0.5) * 0.25 + Math.sin(t * 1.3 + i * 0.15) * 0.15;
          return Math.max(0.05, Math.min(1, base * wave * 1.1));
        }),
      );
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ── Procedural meters (rAF wobble) ──
  const [lufsShort, setLufsShort] = useState(phase1?.lufs ?? -14);
  const [truePeak, setTruePeak] = useState(phase1?.true_peak_db ?? phase1?.peak_dbfs ?? -1);
  const [correlation, setCorrelation] = useState(phase1?.stereo_correlation ?? 0.6);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now() / 1000;
    const baseLufs = phase1?.lufs ?? -14;
    const basePeak = phase1?.true_peak_db ?? phase1?.peak_dbfs ?? -1;
    const baseCorr = phase1?.stereo_correlation ?? 0.6;
    function frame() {
      const t = performance.now() / 1000 - t0;
      setLufsShort(baseLufs + Math.sin(t * 1.7) * 0.7);
      setTruePeak(basePeak + Math.sin(t * 2.3) * 0.15);
      setCorrelation(Math.max(-1, Math.min(1, baseCorr + Math.sin(t * 0.8) * 0.05)));
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, phase1]);

  // ── Procedural waveform (memoized per duration) ──
  const waveform = useMemo(() => {
    return Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      const sectionIdx = STUB_SECTIONS.findIndex(
        (sec) => i / WAVEFORM_BARS >= sec.startPct && i / WAVEFORM_BARS < sec.endPct,
      );
      const amp = sectionIdx === 2 ? 0.95 : sectionIdx === 1 ? 0.7 : sectionIdx === 3 ? 0.55 : 0.4;
      const noise = Math.sin(i * 0.7) * 0.3 + Math.sin(i * 2.3) * 0.18 + 0.5;
      return amp * (0.4 + noise * 0.6);
    });
  }, []);

  // ── Notes (client-side stub until BFF /notes ships) ──
  const [notes, setNotes] = useState<StubNote[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [activeNote, setActiveNote] = useState<string | null>(null);

  const handleAddNote = () => {
    if (!noteInput.trim() || !duration) return;
    const pct = duration > 0 ? position / duration : 0;
    const newNote: StubNote = {
      id: `note-${Date.now()}`,
      timePct: pct,
      body: noteInput.trim(),
      pinned: false,
    };
    setNotes((n) => [...n, newNote]);
    setNoteInput('');
  };

  // ── Tools ──
  const [activeTool, setActiveTool] = useState<string | null>(null);
  useEffect(() => {
    if (verdict_id) {
      toast.info('Preset handoff from Coach not yet wired.');
    }
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
        <Link to="/library" className={s.backLink}>
          ← Library
        </Link>
        <p className={s.error}>Version not found.</p>
      </div>
    );
  }

  const trackName = song?.name ?? `Version ${version.versionNumber}`;
  const grade = song?.latestResult?.grade;
  const hue = song?.id ? hueFromId(song.id) : 168;
  const positionPct = duration > 0 ? position / duration : 0;
  const currentSection =
    STUB_SECTIONS.find((sec) => positionPct >= sec.startPct && positionPct < sec.endPct) ??
    STUB_SECTIONS[0];

  return (
    <div className={s.page}>
      <Link to="/library" className={s.backLink}>
        ← Library
      </Link>

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
            {phase1?.bpm != null && (
              <Pill>
                <span className="mono">{fmtBpm(phase1.bpm)}</span> BPM
              </Pill>
            )}
            {phase1?.detected_key && (
              <Pill>
                <span className="mono">{phase1.detected_key}</span>
              </Pill>
            )}
            {phase1?.lufs != null && (
              <Pill>
                <span className="mono">{fmtNumber(phase1.lufs, 1)}</span> LUFS
              </Pill>
            )}
            <Pill>
              <span className="mono">v{version.versionNumber}</span>
            </Pill>
          </div>
        </div>
        <div className={s.headerRight}>
          {grade && <GradePill grade={grade} size="sm" />}
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
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: SECTION_COLORS[currentSection.type],
              }}
            />
            <span>{currentSection.name}</span>
          </div>
          <div className={s.liveStrip}>
            <LivePill label="LUFS-S" value={fmtNumber(lufsShort, 1)} />
            <LivePill label="Peak" value={fmtNumber(truePeak, 1)} />
            <LivePill label="Corr" value={fmtNumber(correlation, 2)} />
          </div>
          <div className={s.spectrumWrap} aria-hidden="true">
            {spectrumValues.map((v, i) => (
              <div
                key={i}
                className={s.spectrumBar}
                style={{ height: `${Math.round(v * 92)}%` }}
              />
            ))}
          </div>
          <div className={s.freqGrid}>
            <span>20</span>
            <span>60</span>
            <span>200</span>
            <span>500</span>
            <span>1k</span>
            <span>2k</span>
            <span>5k</span>
            <span>10k</span>
            <span>20k</span>
          </div>
        </div>

        <div className={s.heroTransport}>
          <Scrubber
            sections={STUB_SECTIONS}
            waveform={waveform}
            positionPct={positionPct}
            duration={duration}
            notes={notes}
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
            <button
              type="button"
              className={s.transportBtn}
              onClick={() => seek(Math.max(0, positionPct - 0.05))}
              aria-label="Back 5%"
            >
              ⏮
            </button>
            <button
              type="button"
              className={s.transportBtn}
              onClick={() => seek(Math.min(1, positionPct + 0.05))}
              aria-label="Forward 5%"
            >
              ⏭
            </button>
            <span className={s.timecode}>
              {formatTime(position)} / {formatTime(duration)}
            </span>
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
              onClick={() => {
                if (!duration) return;
                const note: StubNote = {
                  id: `note-${Date.now()}`,
                  timePct: position / duration,
                  body: `Note @ ${formatTime(position)}`,
                  pinned: false,
                };
                setNotes((n) => [...n, note]);
                toast.success('Note added (local only)');
              }}
              disabled={!duration}
            >
              + Note @ time
            </button>
          </div>
        </div>
      </section>

      <section className={`card ${s.toolsRail}`}>
        <header className={s.toolsRailHd}>
          <div className={s.toolsTitle}>
            <span className="dot" />
            Preview adjustments
          </div>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            visual only · DSP slice ships separately
          </span>
        </header>
        <div className={s.toolGrid}>
          {PREVIEW_TOOLS.map((t) => (
            <ToolTile
              key={t.id}
              tool={t}
              active={activeTool === t.id}
              onClick={() => setActiveTool((cur) => (cur === t.id ? null : t.id))}
            />
          ))}
        </div>
        {activeTool && (
          <ToolPanel
            tool={PREVIEW_TOOLS.find((t) => t.id === activeTool)!}
            onClose={() => setActiveTool(null)}
          />
        )}
      </section>

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
                  <li key={n.id}>
                    <button
                      type="button"
                      className={s.noteRow}
                      data-active={activeNote === n.id}
                      onClick={() => {
                        setActiveNote(n.id);
                        seek(n.timePct);
                      }}
                    >
                      <span className={s.noteIcon} data-pinned={n.pinned}>
                        {n.pinned ? '★' : '·'}
                      </span>
                      <div>
                        <div className={s.noteMeta}>
                          <span>@{formatTime(n.timePct * duration)}</span>
                          {n.pinned && (
                            <span style={{ color: 'var(--cyan)' }}>PINNED</span>
                          )}
                        </div>
                        <div className={s.noteBody}>{n.body}</div>
                      </div>
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddNote();
                  }
                }}
              />
              <span className={s.newNoteTime}>@{formatTime(position)}</span>
              <button
                type="button"
                className="btn primary sm"
                onClick={handleAddNote}
                disabled={!noteInput.trim()}
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
              <ContextStat
                label="Duration"
                value={duration > 0 ? formatTime(duration) : '—'}
              />
              <ContextStat label="Key" value={phase1?.detected_key ?? '—'} />
              <ContextStat
                label="LUFS"
                value={phase1?.lufs != null ? fmtNumber(phase1.lufs, 1) : '—'}
              />
              <ContextStat
                label="Mono"
                value={
                  phase1?.mono_compatibility != null
                    ? `${Math.round(phase1.mono_compatibility * 100)}%`
                    : '—'
                }
              />
            </div>
          </section>
        </div>

        <aside className={s.meterRail}>
          <section className={`card ${s.meterCard}`}>
            <header className={s.cardHd}>
              <span className={s.cardTitle}>Live meters</span>
              <Pill tone={playing ? 'cyan' : 'neutral'}>{playing ? 'live' : 'idle'}</Pill>
            </header>
            <MeterRow
              label="Short LUFS"
              value={fmtNumber(lufsShort, 1)}
              fillPct={Math.max(0, Math.min(1, (lufsShort + 30) / 30))}
              color="var(--cyan)"
            />
            <MeterRow
              label="True peak"
              value={fmtNumber(truePeak, 1)}
              fillPct={Math.max(0, Math.min(1, (truePeak + 12) / 12))}
              color={truePeak > -1 ? 'var(--orange)' : 'var(--cyan)'}
            />
            <MeterRow
              label="Correlation"
              value={fmtNumber(correlation, 2)}
              fillPct={(correlation + 1) / 2}
              color={correlation < 0 ? 'var(--red)' : correlation < 0.3 ? 'var(--yellow)' : 'var(--cyan)'}
            />
            <MeterRow
              label="Width"
              value={
                phase1?.stereo_width != null ? `${Math.round(phase1.stereo_width * 100)}%` : '—'
              }
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
              <span>20Hz</span>
              <span>1kHz</span>
              <span>20kHz</span>
            </div>
          </section>
        </aside>
      </div>

      {audioUrl && (
        // The <audio> element is invisible — playback is driven by the transport
        // row above. preload="auto" makes Range requests for fast seek.
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          crossOrigin="anonymous"
        />
      )}
    </div>
  );
}

interface ScrubberProps {
  sections: StubSection[];
  waveform: number[];
  positionPct: number;
  duration: number;
  notes: StubNote[];
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

  return (
    <div className={s.scrubber}>
      <div className={s.scrubberRibbon} aria-hidden="true">
        {sections.map((sec) => (
          <div
            key={sec.name}
            className={s.ribbonSection}
            style={{
              flex: sec.endPct - sec.startPct,
              background: SECTION_COLORS[sec.type],
            }}
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
            style={{
              left: `${n.timePct * 100}%`,
              opacity: activeNote === n.id ? 1 : 0.7,
            }}
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
        <button
          key={o}
          type="button"
          data-active={value === o}
          onClick={() => onChange(o)}
        >
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
          style={{
            width: `${Math.max(0, Math.min(1, fillPct)) * 100}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

interface ToolTileProps {
  tool: PreviewTool;
  active: boolean;
  onClick: () => void;
}

function ToolTile({ tool, active, onClick }: ToolTileProps) {
  return (
    <button
      type="button"
      className={s.toolTile}
      data-active={active}
      data-tier={tool.tier}
      style={
        {
          ['--tile-color' as string]: tool.accent,
          ['--tile-bg' as string]: `${tool.accent}14`,
          ['--tile-border' as string]: `${tool.accent}50`,
        } as React.CSSProperties
      }
      onClick={onClick}
    >
      <div className={s.toolGlyphRow}>
        <span className={s.toolGlyph}>{tool.glyph}</span>
        <span className={s.toolLabel}>{tool.label}</span>
        {tool.tier === 'v2' && <span className={s.toolTierBadge}>SOON</span>}
      </div>
      <div className={s.toolSub}>{tool.sub}</div>
    </button>
  );
}

function ToolPanel({ tool, onClose }: { tool: PreviewTool; onClose: () => void }) {
  return (
    <div
      className={s.toolPanel}
      style={{ ['--panel-accent' as string]: tool.accent } as React.CSSProperties}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className={s.toolPanelTitle}>{tool.label}</span>
        <button type="button" className="btn sm ghost" onClick={onClose}>
          close
        </button>
      </div>
      <p className={s.toolPanelSub}>{tool.description}</p>
      <p className={s.toolPanelEmpty}>
        DSP graph ships in the Listen-DSP slice. This panel is visual scaffolding only.
      </p>
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
