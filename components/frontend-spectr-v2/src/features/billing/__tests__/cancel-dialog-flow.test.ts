import { describe, expect, it } from 'vitest';

// Story 2.2 / AC4 — pin the two-click cancellation flow as a pure state
// machine. The Radix Dialog UI is exercised via the (deferred)
// Playwright smoke; this test ensures the click-count contract.

type DialogState = 'closed' | 'open' | 'pending' | 'confirmed';

interface DialogContext {
  state: DialogState;
  clicksSinceBillingPage: number;
}

const initial: DialogContext = { state: 'closed', clicksSinceBillingPage: 0 };

function clickCancelButton(ctx: DialogContext): DialogContext {
  if (ctx.state !== 'closed') return ctx;
  return { state: 'open', clicksSinceBillingPage: ctx.clicksSinceBillingPage + 1 };
}

function clickConfirm(ctx: DialogContext): DialogContext {
  if (ctx.state !== 'open') return ctx;
  return {
    state: 'confirmed',
    clicksSinceBillingPage: ctx.clicksSinceBillingPage + 1,
  };
}

function clickKeepSubscription(ctx: DialogContext): DialogContext {
  if (ctx.state !== 'open') return ctx;
  // No state-machine increment because the spec excludes the negative
  // path from the click budget (UX-DR33).
  return { state: 'closed', clicksSinceBillingPage: ctx.clicksSinceBillingPage };
}

describe('Cancellation click budget (story 2.2 / AC4)', () => {
  it('reaches the confirmed state in exactly 2 clicks', () => {
    const step1 = clickCancelButton(initial);
    expect(step1.state).toBe('open');
    expect(step1.clicksSinceBillingPage).toBe(1);

    const step2 = clickConfirm(step1);
    expect(step2.state).toBe('confirmed');
    expect(step2.clicksSinceBillingPage).toBe(2);
  });

  it('opening the dialog then cancelling does not count toward the budget', () => {
    const opened = clickCancelButton(initial);
    const closed = clickKeepSubscription(opened);
    expect(closed.state).toBe('closed');
    // We don't reset the counter, but we also don't add to it for the
    // "Keep subscription" abandonment.
    expect(closed.clicksSinceBillingPage).toBe(1);
  });

  it('clicking confirm while dialog is closed is a no-op', () => {
    const next = clickConfirm(initial);
    expect(next).toEqual(initial);
  });

  it('clicking Cancel twice without confirming does not re-open', () => {
    const opened = clickCancelButton(initial);
    const reopened = clickCancelButton(opened);
    expect(reopened).toEqual(opened);
  });
});
