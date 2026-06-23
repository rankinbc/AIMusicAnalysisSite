import type { ReactNode } from 'react';

import s from './BlurLock.module.css';

// Story 2.7 / UX-DR29 — ONE component for all gating surfaces. When
// `locked` is false it renders children untouched (zero overhead in the
// ungated path). When locked, the real children render underneath
// (blurred + inert) so the user sees what they're missing, and a single
// CTA + one-line reason float on top. The lock reason is announced to
// assistive tech via the overlay's role="group" + aria-label.

interface BlurLockProps {
  locked: boolean;
  /** One-line unlock copy, also used as the overlay's accessible name. */
  reason: string;
  /** Single CTA label (e.g. "Get Pro"). */
  ctaLabel: string;
  onUnlock: () => void;
  children: ReactNode;
}

export function BlurLock({ locked, reason, ctaLabel, onUnlock, children }: BlurLockProps) {
  if (!locked) return <>{children}</>;

  return (
    <div className={s.wrap}>
      {/* Real content, obscured + removed from the a11y tree and tab order. */}
      <div className={s.blurred} aria-hidden="true" inert>
        {children}
      </div>
      <div className={s.overlay} role="group" aria-label={reason}>
        <div className={s.panel}>
          <p className={s.reason}>{reason}</p>
          <button type="button" className="btn primary" onClick={onUnlock}>
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
