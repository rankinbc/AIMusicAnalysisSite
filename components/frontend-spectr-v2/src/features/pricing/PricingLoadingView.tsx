/* Task P2 (public-surfaces-polish D7) — the neutral state: before
 * loadPublicPlans() answers, and when it never does (network failure, 500,
 * or a resolved-but-unknown creditsEnabled). Same heading either way — only
 * `failed` decides whether we say so instead of showing a skeleton. Never
 * shows a price or plan copy: we don't yet know whether credits are on. */
import { PublicChrome } from '../../components/PublicChrome';
import s from './pricing.module.css';

export function PricingLoadingView({ failed }: { failed: boolean }) {
  return (
    <>
    <PublicChrome />
    <main className={s.shell}>
      <header className={s.header}>
        <span className="label">Pricing</span>
        <h1 className={s.title}>Pricing</h1>
        {failed ? (
          <p className={s.subtitle}>Pricing couldn&rsquo;t load — refresh to try again.</p>
        ) : (
          <p className={`mono ${s.taxNote}`}>Loading…</p>
        )}
      </header>

      {!failed && (
        <div className={s.skeletonGrid} aria-hidden="true">
          <div className={s.skeletonCard} />
          <div className={s.skeletonCard} />
          <div className={s.skeletonCard} />
        </div>
      )}
    </main>
    </>
  );
}
