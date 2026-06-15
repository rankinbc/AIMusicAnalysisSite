// Story 1.4 / FR16 / UX-DR17: rendered above the verdict list when the
// worker stamped a DegradationNotice on the analysis. Tells the user the
// AI verdict generator is unavailable but the rule-based findings below
// are real and the analysis itself is unaffected.
//
// Built on the global design-system primitives (`.card`, `.label`,
// `.pill.orange`) per spec — no bespoke layout system.

import type { DegradationNoticeDto } from '../../api/types';
import s from './DegradationBanner.module.css';
import { DEGRADATION_COPY } from './degradationCopy';

interface DegradationBannerProps {
  notice: DegradationNoticeDto;
}

export function DegradationBanner({ notice }: DegradationBannerProps) {
  const copy = DEGRADATION_COPY[notice.reason];
  return (
    <section
      className={`card ${s.banner}`}
      role="status"
      aria-live="polite"
      data-reason={notice.reason}
    >
      <div className={s.headRow}>
        <span className="label">AI verdicts offline</span>
        <span className="pill orange">
          <span className={s.dot} aria-hidden="true" />
          rule-based
        </span>
      </div>
      <h3 className={s.headline}>{copy.headline}</h3>
      <p className={s.text}>{copy.body}</p>
    </section>
  );
}
