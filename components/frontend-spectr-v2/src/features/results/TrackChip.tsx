import s from './TrackChip.module.css';

interface TrackChipProps {
  name: string;
  /** Jump to the .als Project panel for this named track (FR12). */
  onActivate: (name: string) => void;
}

/** Cyan inline chip naming an .als project track inside verdict prose. */
export function TrackChip({ name, onActivate }: TrackChipProps) {
  return (
    <button
      type="button"
      className={s.chip}
      onClick={() => onActivate(name)}
      title={`Show ${name} in the project panel`}
    >
      {name}
    </button>
  );
}
