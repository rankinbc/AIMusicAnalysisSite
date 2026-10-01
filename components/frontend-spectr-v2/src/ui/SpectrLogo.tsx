/* The one SPECTR lockup — mark + wordmark + "AI Music Analysis" caption —
 * used by every top bar (in-app, public chrome, auth pages) so they can't
 * drift apart. The wrapping link/aria-label stays with each caller. */
import { BrandMark } from './BrandMark';
import s from './SpectrLogo.module.css';

const MARK_PX = { sm: 22, lg: 34, xl: 48 } as const;

/* `xl` is the hero size above the live analysis page — same lockup, same
 * type treatment, scaled up (see SpectrLogo.module.css). */
export function SpectrLogo({ size = 'sm' }: { size?: 'sm' | 'lg' | 'xl' }) {
  return (
    <span className={s.logo} data-size={size}>
      <BrandMark size={MARK_PX[size]} glow />
      <span className={s.text}>
        <span className={s.word}>SPECTR</span>
        <span className={s.caption}>AI Music Analysis</span>
      </span>
    </span>
  );
}
