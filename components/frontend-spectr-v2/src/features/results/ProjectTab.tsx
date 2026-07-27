import type { CSSProperties } from 'react';

import type {
  AlsProjectJson,
  AlsProjectTrack,
  Phase8Data,
  Phase8Chord,
  Phase8MidiAnalysis,
  Phase8MidiIssue,
} from '../../api/types';

interface ProjectTabProps {
  project: AlsProjectJson;
  /** Worker phase-8 health/arrangement read (when the .als was analyzed). */
  phase8?: Phase8Data | undefined;
  /** Story 5.7 (AC3): phase 8 ran and failed/was sandboxed out — the tab
   *  renders the client-parsed map but must SAY the server analysis is
   *  missing (health/arrangement fall back silently otherwise). */
  phase8Failed?: boolean;
}

// ── prototype palettes (ar-project.jsx / ar-data.jsx) ──────────────────────
const AR_SECTION_COLORS: Record<string, string> = {
  Intro: '#8fa5c0',
  Build: '#ffd166',
  Breakdown: '#b39df2',
  Drop: '#5bd0c0',
  'Drop 2': '#9ce37d',
  Mid: '#6db4f2',
  Outro: '#8fa5c0',
};

const AR_TRK_COLORS = ['#c98a5a', '#c9b45a', '#8fb46a', '#5ab0a4', '#5a94c9', '#9d8fc9', '#c97da8', '#b0b06a'];

const AR_SEV_COLOR: Record<string, string> = {
  critical: 'var(--sev-critical)',
  severe: 'var(--sev-severe)',
  moderate: 'var(--sev-moderate)',
  minor: 'var(--sev-minor)',
  win: 'var(--sev-win)',
};
const arSevColor = (s: string | undefined): string => AR_SEV_COLOR[s ?? ''] ?? AR_SEV_COLOR.minor;

// The Project tab (.als): health + arrangement up top, then per-track device
// chains in signal order, MIDI detail, plugins, MIDI health. Reads the
// client-parsed .als map (device names) + worker phase 8 (health/muted/MIDI).
export function ProjectTab({ project, phase8, phase8Failed = false }: ProjectTabProps) {
  const version = phase8?.ableton_version ?? project.abletonVersion ?? '';
  const tempo = phase8?.tempo ?? project.tempo ?? '—';
  const timeSig = phase8?.time_signature ?? project.timeSignature ?? '—';
  const totalDevices = phase8?.total_devices ?? project.devices.length;
  const disabledDevices = phase8?.disabled_devices ?? 0;
  const clutterPct = phase8?.clutter_pct;
  const sections = phase8?.arrangement?.sections ?? [];
  const plugins = project.plugins.length > 0 ? project.plugins : (phase8?.plugin_list ?? []);
  const mutedByName = new Map<string, boolean>((phase8?.tracks ?? []).map((t) => [t.name, t.muted]));
  const midi = phase8?.midi;
  const midiAnalysis = phase8?.midi_analysis ?? [];

  return (
    <div className="ti-stack proj fade-up">
      <p className="tab-intro" style={{ marginBottom: 12 }}>
        <b>From your Ableton project.</b> Read directly from{' '}
        <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{project.source || 'your Ableton project'}</span> —
        device clutter, MIDI health and arrangement, independent of the audio analysis.
      </p>

      {phase8Failed && (
        <p className="tab-intro" data-testid="project-analysis-skipped" style={{ marginBottom: 12 }}>
          <b>Server project analysis was skipped this run</b> — it hit a snag, so health scoring and MIDI findings
          below show what the browser could read from the file. Everything else in this report is unaffected; a retry
          fills this in.
        </p>
      )}

      <div className="proj-grid" style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="card-hd">
            <span className="t">
              <span className="led" />
              Project health
            </span>
            {version && <span className="meta">{version}</span>}
          </div>
          <div className="card-body">
            <div className="proj-health">
              <HealthRing score={phase8?.health_score} />
              <div className="pstats">
                <PStat k="Tempo" v={`${tempo}`} u="BPM" />
                <PStat k="Time sig" v={`${timeSig}`} />
                <PStat k="Devices" v={`${totalDevices}`} u={disabledDevices ? `${disabledDevices} off` : ''} />
                {clutterPct != null && (
                  <PStat k="Clutter" v={`${clutterPct}%`} warn={clutterPct > 12} />
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <span className="t">
              <span className="led" />
              Arrangement
            </span>
            <span className="meta">from .als markers</span>
          </div>
          <div className="card-body">
            {sections.length > 0 ? (
              <ArrangementStrip sections={sections} />
            ) : (
              <div className="na">No arrangement markers were found in this project.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-hd">
          <span className="t">
            <span className="led" />
            Tracks
          </span>
          <span className="meta">{project.tracks.length} tracks · device chain order</span>
        </div>
        <div className="card-body">
          {project.tracks.length > 0 ? (
            <div className="tracks-grid">
              {project.tracks.map((t, i) => (
                <TrackBlock
                  key={`${t.index}-${t.name}`}
                  track={t}
                  color={AR_TRK_COLORS[i % AR_TRK_COLORS.length]}
                  muted={mutedByName.get(t.name) ?? false}
                />
              ))}
            </div>
          ) : (
            <div className="na">No audio or MIDI tracks were found in this project.</div>
          )}
        </div>
      </div>

      {midiAnalysis.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-hd">
            <span className="t">
              <span className="led" />
              MIDI detail — chords &amp; swing
            </span>
            <span className="meta">{midiAnalysis.length} tracks</span>
          </div>
          <div className="card-body">
            <div className="ma-rows">
              {midiAnalysis.map((row, i) => (
                <MidiAnalysisRow key={`${row.track_name ?? 'track'}-${i}`} row={row} />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-hd">
          <span className="t">
            <span className="led" />
            Plugins &amp; devices
          </span>
          <span className="meta">{plugins.length} unique</span>
        </div>
        <div className="card-body">
          {plugins.length > 0 ? (
            <div className="plugin-chips">
              {plugins.map((pl, i) => (
                <span className="plugin-chip" key={`${pl}-${i}`}>
                  {pl}
                </span>
              ))}
            </div>
          ) : (
            <div className="na">No third-party plugins detected.</div>
          )}
        </div>
      </div>

      {midi && (
        <div className="card">
          <div className="card-hd">
            <span className="t">
              <span className="led" />
              MIDI health
            </span>
            <span className="meta">{phase8?.has_humanized_midi ? 'humanized ✓' : 'quantized'}</span>
          </div>
          <div className="card-body">
            <div className="pstats" style={{ marginBottom: 12 }}>
              <PStat k="Notes" v={(phase8?.midi_note_count ?? midi.total_notes ?? 0).toLocaleString()} />
              <PStat
                k="Quant issues"
                v={`${phase8?.quantization_issues_count ?? 0}`}
                warn={(phase8?.quantization_issues_count ?? 0) > 0}
              />
            </div>
            {(midi.issues ?? []).map((mi: Phase8MidiIssue, i) => (
              <div className="midi-issue" key={`${mi.track}-${i}`}>
                <span className="mi-sev" style={{ background: arSevColor(mi.severity) }} />
                <div className="mi-b">
                  <div className="mt">
                    <span className="mono" style={{ color: 'var(--violet)', fontSize: 11 }}>
                      {mi.track}
                    </span>
                  </div>
                  <div className="mf">{mi.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthRing({ score, size = 46 }: { score: number | undefined; size?: number }) {
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  const col = pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--accent)' : 'var(--orange)';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dim)" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: col, lineHeight: 1 }}>
          {score ?? '—'}
        </span>
      </div>
    </div>
  );
}

function ArrangementStrip({ sections }: { sections: { name: string; duration_bars: number }[] }) {
  const total = sections.reduce((s, x) => s + (x.duration_bars || 0), 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 1, height: 24, overflow: 'hidden', border: '1px solid rgba(0,0,0,.5)' }}>
        {sections.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            title={`${s.name} · ${s.duration_bars} bars`}
            style={{
              width: `${total > 0 ? (s.duration_bars / total) * 100 : 100 / sections.length}%`,
              background: AR_SECTION_COLORS[s.name] || '#4a5568',
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              borderLeft: i > 0 ? '1px solid rgba(0,0,0,.45)' : 'none',
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                color: 'rgba(0,0,0,.72)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                padding: '0 4px',
              }}
            >
              {s.name}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mono"
        style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9.5, color: 'var(--muted)' }}
      >
        <span>{sections.length} sections</span>
        <span>{total} bars</span>
      </div>
    </div>
  );
}

function PStat({ k, v, u, warn }: { k: string; v: string; u?: string; warn?: boolean }) {
  return (
    <div className="pstat">
      <span className="k">{k}</span>
      <span className="v" style={warn ? { color: 'var(--orange)' } : undefined}>
        <span className="mono">{v}</span>
        {u && <span className="u">{u}</span>}
      </span>
    </div>
  );
}

function TrackBlock({ track, color, muted }: { track: AlsProjectTrack; color: string; muted: boolean }) {
  return (
    <div className="trk-block" style={{ ['--tc' as string]: color } as CSSProperties}>
      <div className="trk-head">
        <span className="trk-swatch" />
        <span className={`trk-n${muted ? ' muted' : ''}`}>{track.name}</span>
        {muted && <span className="trk-muted mono">muted</span>}
        <span className="trk-type mono">{track.type}</span>
        <span className="trk-count mono">{track.devices.length} dev</span>
      </div>
      <div className="trk-chain">
        {track.devices.length === 0 ? (
          <span className="dev-chip off">
            <span className="dc-led" />
            no devices
          </span>
        ) : (
          track.devices.map((d, j) => (
            <span className="dev-chip" key={`${d}-${j}`}>
              <span className="dc-led" />
              {d}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function MidiAnalysisRow({ row }: { row: Phase8MidiAnalysis }) {
  const stats: string[] = [];
  if (row.swing_ratio != null) stats.push(`swing ${row.swing_ratio.toFixed(2)}`);
  if (row.humanization_score != null) stats.push(`human ${Math.round(row.humanization_score * 100)}%`);
  if (row.note_density_per_bar != null) stats.push(`${row.note_density_per_bar} notes/bar`);
  const chords = row.chords ?? [];
  return (
    <div className="ma-row">
      <span className="ma-t mono">{row.track_name ?? 'Track'}</span>
      <span className="ma-stats mono">{stats.join(' · ')}</span>
      <span className="ma-chords">
        {chords.length > 0 ? (
          chords.map((c: Phase8Chord, j) => (
            <span className="ma-chord" key={j} title={c.time != null ? String(c.time) : undefined}>
              {c.chord_name ?? '?'}
            </span>
          ))
        ) : (
          <span className="ma-none">no chords</span>
        )}
      </span>
    </div>
  );
}
