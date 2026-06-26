import { useMemo } from 'react';

import type { Phase1Data, Phase1Segment, Phase1Structure } from '../../api/types';
import s from './SongMap.module.css';

interface SongMapProps {
  phase1: Phase1Data | undefined;
}

/** Merged section (consecutive same-label allin1 segments collapsed into one). */
interface MergedSection {
  label: string;
  start: number;
  end: number;
  bars: number;
}

/** Per-section accent — keyed by allin1 label family. Falls back to slate. */
const SECTION_COLOR: Record<string, string> = {
  intro: 'var(--violet)',
  buildup: 'var(--yellow)',
  build: 'var(--yellow)',
  drop: 'var(--cyan)',
  chorus: 'var(--red)',
  verse: 'var(--green)',
  inst: 'var(--cyan)',
  break: 'var(--orange)',
  breakdown: 'var(--orange)',
  bridge: 'var(--orange)',
  outro: 'var(--violet)',
};

function sectionColor(label: string): string {
  return SECTION_COLOR[label.toLowerCase()] ?? '#64748b';
}

function mergeSegments(segments: Phase1Segment[], downbeats: number[]): MergedSection[] {
  const merged: MergedSection[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === seg.label && Math.abs(prev.end - seg.start) < 0.05) {
      prev.end = seg.end;
    } else {
      merged.push({ label: seg.label, start: seg.start, end: seg.end, bars: 0 });
    }
  }
  for (const m of merged) {
    m.bars = downbeats.filter((d) => d >= m.start - 1e-6 && d < m.end - 1e-6).length;
  }
  return merged;
}

/** Compares the librosa phase-1 BPM against allin1's independent structure BPM.
 *  A ~2× ratio means the displayed tempo is half/double-time (an octave error). */
function detectOctaveError(
  bpm: number | undefined,
  structBpm: number | undefined,
): { direction: 'half-time' | 'double-time'; shown: number; corrected: number } | null {
  if (bpm == null || !structBpm) return null;
  const ratio = bpm / structBpm;
  if (ratio >= 0.47 && ratio <= 0.53) return { direction: 'half-time', shown: bpm, corrected: structBpm };
  if (ratio >= 1.89 && ratio <= 2.11) return { direction: 'double-time', shown: bpm, corrected: structBpm };
  return null;
}

const VB_W = 1000;
const VB_H = 132;
const PAD = 8;
const TRACK_TOP = 8;
const TRACK_H = 64;
const GRID_TOP = TRACK_TOP + 4;
const GRID_BOT = TRACK_TOP + TRACK_H - 4;

export function SongMap({ phase1 }: SongMapProps) {
  const structure: Phase1Structure | undefined = phase1?.structure;

  const model = useMemo(() => {
    const segments = structure?.segments ?? [];
    const beats = structure?.beats ?? [];
    const downbeats = structure?.downbeats ?? [];
    const duration =
      phase1?.duration_seconds ||
      segments[segments.length - 1]?.end ||
      beats[beats.length - 1] ||
      0;
    const sections = mergeSegments(segments, downbeats);
    return { segments, beats, downbeats, duration, sections };
  }, [structure, phase1?.duration_seconds]);

  const octave = detectOctaveError(phase1?.bpm, structure?.bpm);

  // ── States ────────────────────────────────────────────────────────────
  if (structure?.deferred) {
    return <p className={s.empty}>Detecting section structure…</p>;
  }
  if (!model.segments.length || model.duration <= 0) {
    return <p className={s.empty}>No section structure detected for this track.</p>;
  }

  const { duration, beats, downbeats, sections } = model;
  const x = (t: number) => PAD + ((VB_W - 2 * PAD) * t) / duration;
  // Thin the beat grid on long tracks; downbeats (bars) always drawn.
  const drawBeats = beats.length <= 512 ? beats : [];

  const totalBars = downbeats.length;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

  return (
    <div className={s.wrap}>
      <div className={s.hd}>
        <span className={s.title}>Song map</span>
        <span className={s.meta}>
          {structure?.bpm != null && <span className="mono">{Math.round(structure.bpm)} BPM</span>}
          {totalBars > 0 && <> · <span className="mono">{totalBars} bars</span></>}
          {duration > 0 && <> · <span className="mono">{fmt(duration)}</span></>}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className={s.svg}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Arrangement timeline: ${sections.map((m) => m.label).join(', ')}`}
      >
        {/* beat grid */}
        {drawBeats.map((b, i) => (
          <line key={`b${i}`} x1={x(b)} y1={GRID_TOP} x2={x(b)} y2={GRID_BOT}
            stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        ))}
        {/* downbeats (bar lines) */}
        {downbeats.map((d, i) => (
          <line key={`d${i}`} x1={x(d)} y1={TRACK_TOP} x2={x(d)} y2={TRACK_TOP + TRACK_H}
            stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
        ))}
        {/* section blocks */}
        {sections.map((m, i) => {
          const x0 = x(m.start);
          const w = Math.max(0, x(m.end) - x0);
          if (w < 0.5) return null;
          const color = sectionColor(m.label);
          const offBar = m.bars > 0 && m.bars % 8 !== 0;
          return (
            <g key={`s${i}`}>
              <rect x={x0} y={TRACK_TOP} width={w} height={TRACK_H} rx={5}
                fill={color} fillOpacity={0.82} />
              {offBar && (
                <rect x={x0 + 0.5} y={TRACK_TOP + 0.5} width={w - 1} height={TRACK_H - 1} rx={5}
                  fill="none" stroke="var(--orange)" strokeWidth={1.5} strokeDasharray="3 2" />
              )}
              {w > 34 && (
                <>
                  <text x={x0 + w / 2} y={TRACK_TOP + 26} className={s.secLabel} textAnchor="middle">
                    {m.label}
                  </text>
                  <text x={x0 + w / 2} y={TRACK_TOP + 42} className={s.secBars} textAnchor="middle">
                    {m.bars} bar{m.bars === 1 ? '' : 's'}{offBar ? ' ⚠' : ''}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {/* time axis */}
        {Array.from({ length: Math.floor(duration / 30) + 1 }, (_, i) => i * 30).map((t) => (
          <g key={`t${t}`}>
            <line x1={x(t)} y1={TRACK_TOP + TRACK_H} x2={x(t)} y2={TRACK_TOP + TRACK_H + 4}
              stroke="var(--muted)" strokeWidth={1} />
            <text x={x(t)} y={TRACK_TOP + TRACK_H + 16} className={s.axis} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
      </svg>

      <div className={s.legend}>
        {sections
          .filter((m, i, arr) => arr.findIndex((o) => o.label === m.label) === i)
          .map((m) => (
            <span key={m.label} className={s.legendItem}>
              <span className={s.swatch} style={{ background: sectionColor(m.label) }} />
              {m.label}
            </span>
          ))}
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ background: 'transparent', border: '1.5px dashed var(--orange)' }} />
          not 8-bar
        </span>
      </div>

      {octave && (
        <div className={s.warn} role="alert">
          <strong>Tempo looks {octave.direction}.</strong> The beat tracker shows{' '}
          <span className="mono">{octave.shown.toFixed(1)} BPM</span>, but the structure detector reads{' '}
          <span className="mono">{Math.round(octave.corrected)} BPM</span> (an exact 2× octave). Genre
          and danceability were computed from the displayed tempo — treat them as suspect until the BPM
          is corrected.
        </div>
      )}
    </div>
  );
}
