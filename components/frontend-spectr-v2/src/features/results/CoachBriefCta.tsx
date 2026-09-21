import { capture } from '../../lib/analytics';
import s from './CoachChat.module.css';

interface CoachBriefCtaProps {
  /** The server's exact closing-line sentence (G-D3) — rendered verbatim,
   *  never hard-coded here. */
  closingLine: string;
}

/** Task G6 — renders under a GUEST's completed brief message: the server's
 *  closing line as the last paragraph of the bubble, plus the
 *  account-creation CTA. Real users never see this (the server omits
 *  `closingLine` for a signed-in user's brief, so the caller never mounts
 *  this component for them). */
export function CoachBriefCta({ closingLine }: CoachBriefCtaProps) {
  return (
    <div className={s.briefCta}>
      <p className={s.briefClosingLine}>{closingLine}</p>
      <a
        href="/register?from=guest"
        className="btn primary"
        onClick={() => capture('guest_signup_clicked')}
      >
        Create free account
      </a>
    </div>
  );
}
