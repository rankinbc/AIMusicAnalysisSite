/* Story 6.4 -> task G5 -> G5 fix1 (item 7) — the landing resume card, now
 * guest-driven. The pre-G5 version resumed an ANON job by device cookie
 * (status-aware, a grade chip, a dismiss button); an upload on /analyze is
 * now a real guest account (AuthContext.user.isGuest), so there's no
 * job-status shape left to key off — LandingResumeSlot renders this for any
 * guest, full stop. Pure + static-render testable (plain <a>, no
 * RouterProvider).
 *
 * Copy: the guest lifetime is a server flag (`guest_ttl_hours`), not a
 * client constant — this component makes no network call (LandingResumeSlot
 * derives visibility from AuthContext alone), so it can't know the real
 * number without one. Worded without a number rather than risk it drifting
 * from the flag. */
import s from './resume-card.module.css';

export function ResumeCard({ onOpen }: { onOpen?: () => void } = {}) {
  return (
    <section className={`card ${s.card}`} data-testid="resume-card">
      <div className={s.body}>
        <span className="label">Welcome back</span>
        <p className={s.line}>Your guest work is still here — pick up where you left off.</p>
      </div>
      <a href="/library" className="btn primary sm" data-testid="resume-open" onClick={onOpen}>
        Open your library →
      </a>
    </section>
  );
}
