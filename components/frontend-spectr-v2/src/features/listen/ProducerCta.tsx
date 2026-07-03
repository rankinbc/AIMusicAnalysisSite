/* Story 11.11 — the discovery loop closer on /v/{token} (pure, static-testable).
 * Anon viewer → register CTA carrying the 7.4 attribution stash + a `next`
 * back to this share page, so the return trip is the "post-claim" moment.
 * Authed viewer (incl. the freshly-claimed) → "Follow @owner" via the 11.9
 * follow surface. Renders nothing without an owner handle or for the owner. */

export function RegisterCta({ token, ownerHandle }: { token: string; ownerHandle: string | null }) {
  const next = `/v/${token}`;
  return (
    <a
      className="btn primary sm"
      data-testid="register-cta"
      href={`/register?via=share_${token}&next=${encodeURIComponent(next)}`}
      onClick={() => {
        // 7.4 attribution carry — write-only stash until 6.5 instrumentation.
        try { localStorage.setItem('spectr_attribution', `share_${token}`); } catch { /* private mode */ }
      }}
    >
      {ownerHandle ? `Join SPECTR & follow @${ownerHandle} →` : 'Analyze your own track free →'}
    </a>
  );
}

export function FollowProducerCta({
  ownerHandle,
  ownerDisplayName,
  isFollowing,
  pending,
  onToggle,
}: {
  ownerHandle: string;
  ownerDisplayName: string | null;
  isFollowing: boolean;
  pending?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div data-testid="follow-producer-cta" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
        by{' '}
        <a href={`/u/${ownerHandle}`} style={{ color: 'var(--violet)', textDecoration: 'none' }}>
          {ownerDisplayName ?? `@${ownerHandle}`}
        </a>
      </span>
      <button
        type="button"
        className={`btn sm ${isFollowing ? 'ghost' : 'primary'}`}
        data-testid="follow-producer-button"
        disabled={pending}
        onClick={onToggle}
      >
        {isFollowing ? 'Following ✓' : `+ Follow @${ownerHandle}`}
      </button>
    </div>
  );
}
