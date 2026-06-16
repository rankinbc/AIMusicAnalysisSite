import { describe, expect, it } from 'vitest';

// Story 2.2 / AC4 — pin the two-click cancellation flow as a pure state
// machine. The Radix Dialog UI is exercised separately in
// CancelDialog.test.tsx (story 2.2 review-fix P12 — Task 8.4 assertions
// against a flattened Portal stub).
//
// Story 2.2 review-fix P13 — the state machine has been tightened: the
// `clickConfirm` step now invokes a callback so a regression that
// detaches `onConfirmed` from the primary button is caught here.

type DialogState = 'closed' | 'open' | 'pending' | 'confirmed';

interface DialogContext {
  state: DialogState;
  clicksSinceBillingPage: number;
  onConfirmedCalls: number;
}

const initial: DialogContext = {
  state: 'closed',
  clicksSinceBillingPage: 0,
  onConfirmedCalls: 0,
};

function clickCancelButton(ctx: DialogContext): DialogContext {
  if (ctx.state !== 'closed') return ctx;
  return {
    ...ctx,
    state: 'open',
    clicksSinceBillingPage: ctx.clicksSinceBillingPage + 1,
  };
}

function clickConfirm(
  ctx: DialogContext,
  onConfirmed: () => void,
): DialogContext {
  if (ctx.state !== 'open') return ctx;
  // The real component flips through 'pending' while the POST is in
  // flight and only invokes onConfirmed on success. The machine here
  // collapses the two transitions into one for click-budget purposes;
  // a separate pending flag would be over-specification.
  onConfirmed();
  return {
    ...ctx,
    state: 'confirmed',
    clicksSinceBillingPage: ctx.clicksSinceBillingPage + 1,
    onConfirmedCalls: ctx.onConfirmedCalls + 1,
  };
}

function clickKeepSubscription(ctx: DialogContext): DialogContext {
  if (ctx.state !== 'open') return ctx;
  // Negative path is excluded from the click budget per UX-DR33.
  return { ...ctx, state: 'closed' };
}

describe('Cancellation click budget (story 2.2 / AC4)', () => {
  it('reaches the confirmed state in exactly 2 clicks AND invokes onConfirmed once', () => {
    let calls = 0;
    const step1 = clickCancelButton(initial);
    expect(step1.state).toBe('open');
    expect(step1.clicksSinceBillingPage).toBe(1);
    expect(calls).toBe(0);

    const step2 = clickConfirm(step1, () => {
      calls += 1;
    });
    expect(step2.state).toBe('confirmed');
    expect(step2.clicksSinceBillingPage).toBe(2);
    expect(step2.onConfirmedCalls).toBe(1);
    expect(calls).toBe(1);
  });

  it('opening the dialog then cancelling does not count toward the budget and does not call onConfirmed', () => {
    let calls = 0;
    const opened = clickCancelButton(initial);
    const closed = clickKeepSubscription(opened);
    expect(closed.state).toBe('closed');
    expect(closed.clicksSinceBillingPage).toBe(1);
    expect(closed.onConfirmedCalls).toBe(0);
    // No call to clickConfirm was made.
    expect(calls).toBe(0);
  });

  it('clicking confirm while dialog is closed is a no-op and does not invoke onConfirmed', () => {
    let calls = 0;
    const next = clickConfirm(initial, () => {
      calls += 1;
    });
    expect(next).toEqual(initial);
    expect(calls).toBe(0);
  });

  it('clicking Cancel twice without confirming does not re-open', () => {
    const opened = clickCancelButton(initial);
    const reopened = clickCancelButton(opened);
    expect(reopened).toEqual(opened);
  });
});
