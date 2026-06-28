import { Pill } from '../../ui/Pill';
import s from './ProjectUnlock.module.css';

/**
 * AC3 — shown on the Project tab when no .als was attached. Invites the user to
 * upload one, previewing the benefit (track-named verdicts + project panel)
 * instead of a flat "nothing here" placeholder.
 */
export function ProjectUnlock() {
  return (
    <div className={s.zone}>
      <Pill tone="cyan">Track-named fixes</Pill>
      <h3 className={s.title}>Drop your Ableton project (.als)</h3>
      <p className={s.desc}>
        Re-upload this version with its .als and verdicts will name the exact project
        tracks and devices to fix — plus a full project-structure panel right here.
      </p>
      <span className={s.hint}>Ableton Live 11+ · gzip OK</span>
    </div>
  );
}
