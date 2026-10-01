import s from './MysteryAvatar.module.css';

/**
 * Guest avatar — an anonymous "mystery person": a near-black head-and-
 * shoulders silhouette with a light "?" on the face. Colors come from the
 * --avatar-mystery-* tokens; the circular clip + legibility ring are the
 * container's job (AccountMenu's `.navAvatarGuest`).
 */
export function MysteryAvatar({ label = 'Guest' }: { label?: string }) {
  return (
    <svg
      className={s.svg}
      viewBox="0 0 32 32"
      role="img"
      aria-label={label}
      data-testid="mystery-avatar"
    >
      <circle className={s.silhouette} cx="16" cy="12.5" r="7" />
      <path className={s.silhouette} d="M3 32c0-7.2 5.8-11.5 13-11.5S29 24.8 29 32z" />
      <text
        className={s.glyph}
        x="16"
        y="16"
        textAnchor="middle"
        fontSize="10"
        aria-hidden="true"
      >
        ?
      </text>
    </svg>
  );
}
