import type { AlsProjectJson, AlsProjectTrack, Phase8Data, Phase8MidiAnalysis } from '../../api/types';

interface ProjectTabProps {
  project: AlsProjectJson;
  /** Worker phase-8 health/arrangement read (when the .als was analyzed). */
  phase8?: Phase8Data | undefined;
  /** Story 5.7 (AC3): phase 8 ran and failed/was sandboxed out — the tab
   *  renders the client-parsed map but must SAY the server analysis is
   *  missing (health/arrangement fall back silently otherwise). */
  phase8Failed?: boolean;
}

const SECTION_HUES = [168, 28, 280, 198, 320, 140, 48];

// The Project tab (.als): health + arrangement up top, then per-track device
// chains in signal order. Reads the client-parsed .als map + worker phase 8.
export function ProjectTab({ project, phase8, phase8Failed = false }: ProjectTabProps) {
  const audioCount = project.tracks.filter((t) => t.type === 'audio').length;
  const midiCount = project.tracks.filter((t) => t.type === 'midi').length;
  const deviceTotal = phase8?.total_devices ?? project.devices.length;

  return (
    <div className="ti-stack">
      <p className="tab-intro">
        <b>From your Ableton project.</b> Read from the uploaded{' '}
        <span className="mono">.als</span> — device chains, health, and arrangement, independent of
        the audio analysis.
      </p>

      {phase8Failed && (
        <p className="tab-intro" data-testid="project-analysis-skipped">
          <b>Server project analysis was skipped this run</b> — it hit a snag, so health scoring
          and MIDI findings below show what the browser could read from the file. Everything else
          in this report is unaffected; a retry fills this in.
        </p>
      )}

      <div className="proj-grid">
        <section className="card">
          <div className="card-hd">
            <span className="t">
              <span className="led" /> Project health
            </span>
            {(phase8?.ableton_version ?? project.abletonVersion) && (
              <span className="meta">{phase8?.ableton_version ?? project.abletonVersion}</span>
            )}
          </div>
          <div className="card-body">
            <div className="proj-health">
              <HealthRing score={phase8?.health_score} />
              <div className="proj-stats">
                <ProjStat
                  label="Tempo"
                  value={`${phase8?.tempo ?? project.tempo ?? '—'}`}
                  unit="BPM"
                />
                <ProjStat
                  label="Time sig"
                  value={phase8?.time_signature ?? project.timeSignature ?? '—'}
                  unit=""
                />
                <ProjStat
                  label="Devices"
                  value={`${deviceTotal}`}
                  unit={phase8?.disabled_devices ? `${phase8.disabled_devices} off` : ''}
                />
                {phase8?.clutter_pct != null && (
                  <ProjStat label="Clutter" value={`${phase8.clutter_pct}%`} unit="" />
                )}
              </div>
            </div>
          </div>
        </section>

        {phase8?.arrangement?.sections && phase8.arrangement.sections.length > 0 && (
          <ArrangementCard sections={phase8.arrangement.sections} />
        )}
      </div>

      <section className="card">
        <div className="card-hd">
          <span className="t">
            <span className="led" /> Tracks
          </span>
          <span className="meta">
            {project.tracks.length} tracks · device chain order
          </span>
        </div>
        <div className="card-body">
          {project.tracks.length > 0 ? (
            <div className="tracks-grid">
              {project.tracks.map((t) => (
                <TrackChain key={`${t.index}-${t.name}`} track={t} />
              ))}
            </div>
          ) : (
            <div className="na">No audio or MIDI tracks were found in this project.</div>
          )}
        </div>
      </section>

      {phase8?.midi_analysis && phase8.midi_analysis.length > 0 && (
        <MidiDetailCard tracks={phase8.midi_analysis} />
      )}

      <div className="proj-grid">
        <section className="card">
          <div className="card-hd">
            <span className="t">
              <span className="led" /> Mix
            </span>
            <span className="meta">
              {audioCount} audio · {midiCount} MIDI
            </span>
          </div>
          <div className="card-body">
            {project.plugins.length > 0 ? (
              <div className="plugin-chips">
                {project.plugins.map((p) => (
                  <span key={p} className="plugin-chip">
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              <div className="na">No third-party plugins detected.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function HealthRing({ score }: { score: number | undefined }) {
  const ringSize = 76;
  const stroke = 7;
  const r = (ringSize - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const off = c - (pct / 100) * c;
  return (
    <div className="rv-ring" role="img" aria-label={`Project health ${score ?? 0} of 100`}>
      <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="none" />
        <circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={r}
          stroke="var(--cyan)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
        />
      </svg>
      <span className="rv-num">{score ?? '—'}</span>
    </div>
  );
}

function ArrangementCard({
  sections,
}: {
  sections: { name: string; duration_bars: number }[];
}) {
  const totalBars = sections.reduce((acc, s) => acc + (s.duration_bars || 0), 0);
  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Arrangement
        </span>
        <span className="meta">from .als markers</span>
      </div>
      <div className="card-body">
        <div className="arr-bar">
          {sections.map((sec, i) => {
            const w = totalBars > 0 ? (sec.duration_bars / totalBars) * 100 : 100 / sections.length;
            return (
              <span
                key={`${sec.name}-${i}`}
                className="arr-seg"
                style={{ width: `${w}%`, ['--hue' as string]: String(SECTION_HUES[i % SECTION_HUES.length]) }}
                title={`${sec.name} · ${sec.duration_bars} bars`}
              >
                {sec.name}
              </span>
            );
          })}
        </div>
        <div className="mono lm-ends" style={{ marginTop: 10 }}>
          <span>{sections.length} sections</span>
          <span>{totalBars} bars</span>
        </div>
      </div>
    </section>
  );
}

function TrackChain({ track }: { track: AlsProjectTrack }) {
  return (
    <div>
      <div className="trk-head">
        <span className="trk-name">{track.name}</span>
        <span className="trk-type">{track.type}</span>
        <span className="trk-count">{track.devices.length} dev</span>
      </div>
      {track.devices.length > 0 ? (
        <div className="trk-chain">
          {track.devices.map((d, i) => (
            <span key={`${d}-${i}`} className="dev-chip">
              {d}
            </span>
          ))}
        </div>
      ) : (
        <div className="trk-chain">
          <span className="dev-chip off">no devices</span>
        </div>
      )}
    </div>
  );
}

function MidiDetailCard({ tracks }: { tracks: Phase8MidiAnalysis[] }) {
  // Per-track chord progression + groove (chords capped 48/track by the worker).
  const withDetail = tracks.filter(
    (t) => (t.chords?.length ?? 0) > 0 || t.swing_ratio != null || t.humanization_score != null,
  );
  if (withDetail.length === 0) return null;
  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> MIDI detail — chords &amp; swing
        </span>
        <span className="meta">{withDetail.length} tracks</span>
      </div>
      <div className="card-body">
        <div className="tracks-grid">
          {withDetail.map((t, i) => (
            <div key={`${t.track_name ?? 'track'}-${i}`}>
              <div className="trk-head">
                <span className="trk-name">{t.track_name ?? 'Track'}</span>
                {t.swing_ratio != null && <span className="trk-type">swing {t.swing_ratio.toFixed(2)}</span>}
                {t.humanization_score != null && (
                  <span className="trk-count">human {Math.round(t.humanization_score)}</span>
                )}
              </div>
              {t.chords && t.chords.length > 0 ? (
                <div className="trk-chain">
                  {t.chords.slice(0, 16).map((c, j) => (
                    <span key={j} className="dev-chip">
                      {c.chord_name ?? '?'}
                    </span>
                  ))}
                  {t.chords.length > 16 && <span className="dev-chip off">+{t.chords.length - 16}</span>}
                </div>
              ) : (
                <div className="trk-chain">
                  <span className="dev-chip off">no chords detected</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="proj-stat">
      <span className="mono psl">{label}</span>
      <span className="psv">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}
