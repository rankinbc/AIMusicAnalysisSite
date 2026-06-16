import { Link, createFileRoute } from '@tanstack/react-router';

import s from './billing.module.css';

// Story 2.1 — Stripe Checkout cancellation landing page. Static; the
// only state we know is "the user didn't complete checkout" which Stripe
// already enforces (no charge was made).

export const Route = createFileRoute('/_public/billing/cancelled')({
  component: BillingCancelledPage,
});

function BillingCancelledPage() {
  return (
    <main className={s.shell}>
      <section className={`card ${s.card}`}>
        <span className="label">Checkout cancelled</span>
        <h1 className={s.title}>No charge was made.</h1>
        <p className={s.body}>
          You can subscribe any time from the pricing page.
        </p>
        <div className={s.actions}>
          <Link to="/pricing" className="btn primary">
            Back to plans
          </Link>
          <Link to="/library" className="btn ghost">
            Library
          </Link>
        </div>
      </section>
    </main>
  );
}
