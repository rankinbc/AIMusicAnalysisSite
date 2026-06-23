import type { AlsProjectJson, AlsProjectTrack } from '../../api/types';
import s from './ProjectTab.module.css';

interface ProjectTabProps {
  project: AlsProjectJson;
}

/**
 * "Project awareness" view: the track map SPECTR parsed from the uploaded .als,
 * stored alongside the analysis. Renders project stats + a per-track list with
 * device chips so tracks are visible and referenceable. The authoritative
 * arrangement/health numbers live in the Analysis tab (worker phase 8); this
 * view is the saved structural picture of the project.
 */
export function ProjectTab({ project }: ProjectTabProps) {
  const audioCount = project.tracks.filter((t) => t.type === 'audio').length;
  const midiCount = project.tracks.filter((t) => t.type === 'midi').length;

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <div>
          <h3 className={s.title}>Project structure</h3>
          <p className={s.sub}>
            Parsed from your Ableton project{' '}
            {project.abletonVersion ? `(${project.abletonVersion})` : ''} — analysis is tied to
            these tracks &amp; devices.
          </p>
        </div>
      </div>

      <div className={s.stats}>
        {project.tempo != null && (
          <Stat value={`${project.tempo}`} label="BPM" />
        )}
        <Stat value={project.timeSignature} label="time" />
        <Stat value={`${audioCount}`} label="audio" />
        <Stat value={`${midiCount}`} label="MIDI" />
        <Stat value={`${project.devices.length}`} label="devices" />
        {project.plugins.length > 0 && (
          <Stat value={`${project.plugins.length}`} label="plugins" />
        )}
      </div>

      {project.tracks.length > 0 ? (
        <ul className={s.trackList}>
          {project.tracks.map((t) => (
            <TrackRow key={`${t.index}-${t.name}`} track={t} />
          ))}
        </ul>
      ) : (
        <p className={s.empty}>No audio or MIDI tracks were found in this project.</p>
      )}

      {project.devices.length > 0 && (
        <div className={s.section}>
          <span className={s.sectionLabel}>All devices &amp; plugins</span>
          <div className={s.chipRow}>
            {project.devices.map((d) => (
              <span
                key={d}
                className={`${s.chip} ${project.plugins.includes(d) ? s.plugin : ''}`}
                title={project.plugins.includes(d) ? `${d} (plugin)` : d}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className={s.stat}>
      <b>{value}</b> {label}
    </span>
  );
}

function TrackRow({ track }: { track: AlsProjectTrack }) {
  return (
    <li className={s.track}>
      <span className={s.swatch} style={{ background: swatchColor(track.color) }} aria-hidden />
      <span className={s.trackName} title={track.name}>
        {track.name}
      </span>
      <span className={`${s.typePill} ${track.type === 'midi' ? s.midi : ''}`}>{track.type}</span>
      <div className={s.devices}>
        {track.devices.length > 0 ? (
          track.devices.map((d, i) => (
            <span key={`${d}-${i}`} className={s.deviceChip} title={d}>
              {d}
            </span>
          ))
        ) : (
          <span className={s.noDevices}>no devices</span>
        )}
      </div>
    </li>
  );
}

/**
 * A stable swatch colour for a track. Ableton stores a palette *index*, not a
 * colour value; rather than ship the full 70-swatch palette we map the index to
 * a deterministic hue (golden-angle spacing keeps adjacent tracks distinct).
 * Tracks with no colour get a neutral swatch.
 */
function swatchColor(colorIndex: number | null): string {
  if (colorIndex == null) return 'var(--border-2, #444)';
  const hue = (colorIndex * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 55%, 55%)`;
}
