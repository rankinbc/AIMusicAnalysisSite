import { Pill } from '../../ui/Pill';
import s from './ProjectUnlock.module.css';

/**
 * AC3 — shown on the Project tab when no .als was attached. Invites the user to
 * upload one, previewing the benefit (track-named verdicts + project panel)
 * instead of a flat "nothing here" placeholder.
 *
 * Story 12.5: carries a REAL upload affordance — `onUploadAls` opens the
 * AlsUploadDialog owned by ReportView. Absent (no version attached), the zone
 * stays instructional without a dead button.
 */
export function ProjectUnlock({ onUploadAls }: { onUploadAls?: () => void }) {
  return (
    <div className={s.zone}>
      <Pill tone="cyan">Track-named fixes</Pill>
      <h3 className={s.title}>Drop your Ableton project (.als)</h3>
      <p className={s.desc}>
        Add this version&apos;s .als and verdicts will name the exact project
        tracks and devices to fix — plus a full project-structure panel right here.
      </p>
      {onUploadAls && (
        <button type="button" className="btn primary sm" onClick={onUploadAls}>
          Upload .als
        </button>
      )}
      <span className={s.hint}>Ableton Live 11+ · gzip OK</span>
    </div>
  );
}
