// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LandingPage } from '../../features/landing/LandingPage';
import { PricingPage } from '../pricing';
import { KitchenSinkPage } from '../_app/dev.kitchen-sink';

// Story 5.10 (UX-DR44/46) — axe over the kitchen-sink inventory (the a11y
// audit surface) and the anon funnel pages (landing + pricing — two of the
// five AA routes; they render router-free by design, story 6.1). Login and
// the report surface are covered in report-axe.test.tsx and by the funnel
// pages' shared PublicChrome. color-contrast disabled (jsdom has no paint).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AXE_OPTS = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

async function expectNoViolations(container: HTMLElement) {
  const results = await axeRun(container, AXE_OPTS);
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`,
  );
  expect(summary).toEqual([]);
}

describe('axe WCAG 2.1 AA smoke (story 5.10)', () => {
  it('kitchen-sink inventory is clean', async () => {
    const { container } = render(
      <main>
        <KitchenSinkPage />
      </main>,
    );
    await expectNoViolations(container);
  });

  it('landing page is clean', async () => {
    // LandingResumeSlot probes the anon resume endpoint on mount — stub it out.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const { container } = render(<LandingPage />);
    await expectNoViolations(container);
  });

  it('pricing page is clean', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const { container } = render(<PricingPage />);
    await expectNoViolations(container);
  });
});
