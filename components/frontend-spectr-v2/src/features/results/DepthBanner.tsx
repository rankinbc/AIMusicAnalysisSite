import s from './DepthBanner.module.css';

interface DepthBannerProps {
  /** Which deeper inputs are still missing — drives the copy. */
  missing: { stems: boolean; als: boolean };
  onAddInputs: () => void;
}

/** Shown only when inputs are shallow (mix-only). Hidden once stems/.als land. */
export function DepthBanner({ missing, onAddInputs }: DepthBannerProps) {
  const what = missing.stems && missing.als ? 'stems or your .als' : missing.stems ? 'stems' : 'your .als';
  return (
    <div className={s.banner}>
      <span className={s.icon} aria-hidden>
        ◇
      </span>
      <p className={s.text}>
        Add {what} to turn these into <strong>device-specific fixes with exact settings</strong> —
        right now the plan is directional.
      </p>
      <button type="button" className={`btn sm ${s.cta}`} onClick={onAddInputs}>
        Add files
      </button>
    </div>
  );
}
