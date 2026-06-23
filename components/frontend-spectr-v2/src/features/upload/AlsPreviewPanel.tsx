import type { AlsPreview } from './alsPreview';
import s from '../../components/UploadVersionDialog.module.css';

const MAX_TRACK_CHIPS = 14;
const MAX_DEVICE_CHIPS = 12;

interface Props {
  preview: AlsPreview | null;
  loading: boolean;
  error: string | null;
}

function ChipOverflow({ names, max, midi }: { names: string[]; max: number; midi?: boolean }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className={s.chipRow}>
      {shown.map((name, i) => (
        <span key={`${name}-${i}`} className={`${s.alsChip} ${midi ? s.midi : ''}`} title={name}>
          {name}
        </span>
      ))}
      {extra > 0 && <span className={s.alsChipMore}>+{extra} more</span>}
    </div>
  );
}

/**
 * The "we understand your file" moment: a compact read-out of what we parsed
 * client-side from a dropped `.als` — tempo, time signature, track counts +
 * names, and devices/plugins. Purely presentational.
 */
export function AlsPreviewPanel({ preview, loading, error }: Props) {
  if (loading) {
    return <p className={s.alsPreviewLoading}>Reading your Ableton project…</p>;
  }
  if (error) {
    return <p className={s.alsPreviewError}>{error}</p>;
  }
  if (!preview) return null;

  const allTrackNames = [...preview.audioTracks, ...preview.midiTracks];

  return (
    <div className={s.alsPreview}>
      <div className={s.alsPreviewHead}>
        <span className={s.alsPreviewTitle}>Project understood ✓</span>
        {preview.abletonVersion && <span className={s.alsStat}>{preview.abletonVersion}</span>}
      </div>

      <div className={s.alsStats}>
        {preview.tempo != null && (
          <span className={s.alsStat}>
            <b>{preview.tempo}</b> BPM
          </span>
        )}
        <span className={s.alsStat}>
          <b>{preview.timeSignature}</b> time
        </span>
        <span className={s.alsStat}>
          <b>{preview.audioTracks.length}</b> audio
        </span>
        <span className={s.alsStat}>
          <b>{preview.midiTracks.length}</b> MIDI
        </span>
        {preview.devices.length > 0 && (
          <span className={s.alsStat}>
            <b>{preview.devices.length}</b> devices
          </span>
        )}
      </div>

      {allTrackNames.length > 0 && (
        <div>
          <span className={s.alsSectionLabel}>Tracks</span>
          <div style={{ marginTop: 6 }}>
            <ChipOverflow names={preview.audioTracks} max={MAX_TRACK_CHIPS} />
          </div>
          {preview.midiTracks.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <ChipOverflow
                names={preview.midiTracks}
                max={Math.max(2, MAX_TRACK_CHIPS - preview.audioTracks.length)}
                midi
              />
            </div>
          )}
        </div>
      )}

      {preview.devices.length > 0 && (
        <div>
          <span className={s.alsSectionLabel}>Devices &amp; plugins</span>
          <div style={{ marginTop: 6 }}>
            <ChipOverflow names={preview.devices} max={MAX_DEVICE_CHIPS} />
          </div>
        </div>
      )}
    </div>
  );
}
