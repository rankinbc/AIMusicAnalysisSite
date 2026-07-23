// @vitest-environment jsdom
/* Wave-3 Task 10 — the StrictMode guard behind the invite-accept route's
 * one-shot mutate: dev StrictMode double-invokes effects on the same fiber,
 * so a ref (which survives the simulated remount) must gate the call. */
import { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOneShotEffect } from '../useOneShotEffect';

afterEach(cleanup);

function Probe({ fn }: { fn: () => void }) {
  useOneShotEffect(fn);
  return null;
}

describe('useOneShotEffect', () => {
  it('fires exactly once under StrictMode double-mounted effects', () => {
    const spy = vi.fn();
    render(
      <StrictMode>
        <Probe fn={spy} />
      </StrictMode>,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fires exactly once on a plain mount and not on re-render', () => {
    const spy = vi.fn();
    const { rerender } = render(<Probe fn={spy} />);
    rerender(<Probe fn={spy} />);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
