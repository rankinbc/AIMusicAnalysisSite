// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { SITE } from '../../../config/site';
import { DECISIONS } from '../decisions';
import { EngineeringPage } from '../EngineeringPage';
import stats from '../stats.generated.json';

afterEach(() => {
  cleanup();
});

describe('EngineeringPage', () => {
  const html = renderToStaticMarkup(<EngineeringPage />);

  it('has the binding sections', () => {
    for (const h of [
      'How SPECTR is built',
      'Architecture',
      'Decisions',
      'By the numbers',
      'CI and security',
      'Known limits',
      'Source',
    ]) {
      expect(html).toContain(h);
    }
    // Addendum-approved 8th card (guest-isolation) added since the plan's
    // test template was written — see decisions.ts's top-of-file note.
    expect(DECISIONS).toHaveLength(8);
    for (const d of DECISIONS) expect(html).toContain(d.title);
  });

  it('prints every number as a floor', () => {
    for (const v of Object.values(stats.floors)) expect(html).toContain(`${v.toLocaleString('en-US')}+`);
  });

  it('links the demo and the open-source repo — and nothing personal', () => {
    expect(html).toContain('href="/demo"');
    expect(html).toContain(`href="${SITE.repoUrl}"`);
    expect(html).toContain(`href="${SITE.ciUrl}"`);
    expect(html).not.toMatch(/built by|<img[^>]+github/i);
  });

  it('does not repeat the two claims the repo cannot prove', () => {
    expect(html).not.toMatch(/starve/i);
    expect(html).not.toMatch(/SHA-pinned/i);
  });

  it('does not repeat the two claims corrected in the truth-audit fix round', () => {
    // Fix round 1: the pitch tool no longer couples pitch and tempo (the
    // constant-tempo AudioWorklet lane shipped in 2880789) — "Known limits"
    // must not claim otherwise.
    expect(html).not.toMatch(/pitch and tempo|tempo-independent/i);
    // Fix round 1: "Five CI jobs run on every push" counted the deploy job,
    // which is gated to pushes on the production branch only — it isn't one
    // of the checks that run on every push AND pull request. The old job
    // count must be gone and the exact corrected sentence must be present
    // (the unrelated "CI runs on every push →" source link is untouched).
    expect(html).not.toMatch(/five ci jobs?/i);
    // Task P10 added the public-smoke job (6 jobs total; deploy still the
    // only one gated to pushes on the production branch), so the count of
    // checks that run on every push AND pull request went from four to five.
    expect(html).toContain(
      'Five checks run on every push and pull request; the deploy job runs only on pushes to the production branch.',
    );
  });

  it('has exactly one h1 (axe excludes page-has-heading-one from this run)', () => {
    expect(html.match(/<h1[ >]/g) ?? []).toHaveLength(1);
  });

  it("stays clear of the guard suite's banned phrases", () => {
    expect(html).not.toMatch(/jobs? waiting|jobs? queued|queueDepth|\bfollowers\b|isPublic/i);
  });

  it('is accessible (axe, WCAG 2.1 AA, contrast off — jsdom has no paint)', async () => {
    const { container } = render(
      <main>
        <EngineeringPage />
      </main>,
    );
    const res = await axeRun(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});
