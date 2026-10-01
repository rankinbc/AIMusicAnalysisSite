/* The one SPECTR lockup — mark + wordmark + "AI Music Analysis" caption —
 * used by every top bar (in-app, public chrome, auth pages) so they can't
 * drift apart. The wrapping link/aria-label stays with each caller. */
import { BrandMark } from './BrandMark';
import s from './SpectrLogo.module.css';

export function SpectrLogo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={s.logo} data-size={size}>
      <BrandMark size={size === 'lg' ? 34 : 22} glow />
      <span className={s.text}>
        <span className={s.word}>SPECTR</span>
        <span className={s.caption}>AI Music Analysis</span>
      </span>
    </span>
  );
}
