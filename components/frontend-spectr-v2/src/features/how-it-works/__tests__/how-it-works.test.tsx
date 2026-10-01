// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { HowItWorksPage } from '../HowItWorksPage';
import { DIFFERENTIATORS, STAGES } from '../pipeline';

afterEach(() => {
  cleanup();
});

const STEP_ORDER = [
  'upload',
  'measure',
  'context',
  'deeper',
  'rules',
  'triage',
  'specialists',
  'validate',
  'plan',
  'listen',
  'coach',
];

describe('HowItWorksPage (/trust/how-its-built)', () => {
  const html = renderToStaticMarkup(<HowItWorksPage />);

  it('renders the producer-facing title and section headings', () => {
    for (const h of ['How SPECTR works', 'From upload to a plan', 'What makes it different', 'See it for yourself']) {
      expect(html).toContain(h);
    }
  });

  it('renders every pipeline step in upload -> plan order, numbered continuously', () => {
    expect(STAGES.flatMap((st) => st.steps.map((s) => s.id))).toEqual(STEP_ORDER);
    const positions = STEP_ORDER.map((id) => html.indexOf(`data-step="${id}"`));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Each stage's <ol> picks up where the previous one stopped.
    expect(html).toContain('start="1"');
    expect(html).toContain('start="5"');
    expect(html).toContain('start="9"');
    expect(html).toContain('>11<');
  });

  it('labels which steps are AI and which are deterministic', () => {
    for (const label of ['Measurement', 'Fixed rules', 'AI', 'Validation', 'Your plan', 'In your browser']) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/deterministic rule engine/);
    expect(html).toMatch(/AI can’t rank its own findings/);
  });

  it('carries the differentiators', () => {
    expect(DIFFERENTIATORS.length).toBeGreaterThanOrEqual(6);
    for (const d of DIFFERENTIATORS) expect(html).toContain(d.title);
    expect(html).toContain('score and a few generic tips');
    expect(html).toContain('Your audio never trains a model');
  });

  it('links both CTAs to the right funnels', () => {
    expect(html).toMatch(/<a href="\/demo"[^>]*data-testid="hiw-demo-cta"[^>]*>See it on a real track/);
    expect(html).toMatch(/<a href="\/analyze"[^>]*data-testid="hiw-analyze-cta"[^>]*>Analyze your track free/);
  });

  it('names no other product', () => {
    expect(html).not.toMatch(/trackscore|landr|ozone|izotope|mixcheck|bandlab|emastered|cryo/i);
  });

  it('drops the old engineering-page content', () => {
    expect(html).not.toMatch(/By the numbers|CI and security|Known limits|\bBFF\b|PostgreSQL|Redis/);
  });

  it("stays clear of the guard suite's banned phrases", () => {
    expect(html).not.toMatch(/jobs? waiting|jobs? queued|queueDepth|\bfollowers\b|isPublic|\bshare\b|community/i);
  });

  it('has exactly one h1', () => {
    expect(html.match(/<h1[ >]/g) ?? []).toHaveLength(1);
  });

  it('is accessible (axe, WCAG 2.1 AA, contrast off — jsdom has no paint)', async () => {
    const { container } = render(
      <main>
        <HowItWorksPage />
      </main>,
    );
    const res = await axeRun(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});
