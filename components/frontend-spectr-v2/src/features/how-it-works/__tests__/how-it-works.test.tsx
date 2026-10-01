// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { ARCH_TITLE, DEPLOY_CHAIN } from '../ArchitectureDiagram';
import { buildExamples } from '../examples-model';
import { HowItWorksPage } from '../HowItWorksPage';
import { DIFFERENTIATORS, STAGES } from '../pipeline';
import { PIPELINE_TITLE } from '../PipelineDiagram';

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
    for (const h of [
      'How SPECTR works',
      'The analysis pipeline',
      'What it finds — and what it tells you to do',
      'From upload to a plan',
      'Under the hood',
      'What makes it different',
      'See it for yourself',
    ]) {
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
    expect(html).not.toMatch(/trackscore|landr|ozone|izotope|mixcheck|bandlab|emastered|cryo|mixed in key|sonible|mastering\.com/i);
  });

  it('renders both diagrams as accessible images, in wide and narrow layouts', () => {
    const { container } = render(<HowItWorksPage />);
    const imgs = [...container.querySelectorAll('svg[role="img"]')];
    expect(imgs.map((i) => i.getAttribute('aria-label'))).toEqual([
      PIPELINE_TITLE,
      PIPELINE_TITLE,
      ARCH_TITLE,
      ARCH_TITLE,
    ]);
    for (const svg of imgs) {
      expect(svg.querySelector('title')?.textContent).toBe(svg.getAttribute('aria-label'));
      const descId = svg.getAttribute('aria-describedby');
      expect(descId && svg.querySelector('desc')?.id).toBe(descId);
    }
    // Each marker id is unique even though each layout renders twice.
    const markers = [...container.querySelectorAll('marker')].map((m) => m.id);
    expect(new Set(markers).size).toBe(markers.length);
  });

  it('pipeline diagram shows both diagnosis lanes, the validator and the audio boundary', () => {
    const fig = html.slice(html.indexOf('data-testid="pipeline-diagram"'), html.indexOf('data-testid="example-findings"'));
    for (const node of ['rules', 'triage', 'spec-group', 'validator', 'plan', 'listen', 'coach', 'm-tonal', 'm-als', 'audio-boundary']) {
      expect(fig).toContain(`data-node="${node}"`);
    }
    for (const text of ['Rule engine', 'AI triage', 'Validator', 'measurement ±10%', 'AUDIO STOPS HERE', '7 bands']) {
      expect(fig).toContain(text);
    }
    // Truth rules: no structure/arrangement detection, no stem separation.
    expect(fig).not.toMatch(/arrangement|structure|demucs|separat/i);
  });

  it('architecture diagram shows the verified production stack and deploy chain', () => {
    const fig = html.slice(html.indexOf('data-testid="architecture-diagram"'));
    for (const text of ['React 19', 'ASP.NET Core', '.NET 10', 'PostgreSQL 16', 'Redis 7 + Dramatiq', 'Cloudflare R2', 'Coach worker', 'LLM gateway', 'Anthropic Claude', 'never audio']) {
      expect(fig).toContain(text);
    }
    for (const step of DEPLOY_CHAIN) expect(fig).toContain(step);
    expect(fig).toContain('href="https://github.com/rankinbc/AIMusicAnalysisSite"');
  });

  it('example cards carry real demo verdicts: headline, evidence and fix steps', () => {
    const ex = buildExamples();
    expect(ex).toHaveLength(4);
    expect(ex.map((e) => e.verdict.headline)).toEqual([
      'Excessive sub-bass energy overwhelming the mix',
      'Mix is too narrow — sounds flat and unprofessional',
      'Air band severely deficient — missing trance shimmer and sparkle',
      'Sub-30 Hz rumble wasting headroom',
    ]);
    expect(ex.filter((e) => e.isRule)).toHaveLength(1);
    for (const e of ex) {
      expect(html).toContain(e.verdict.headline);
      expect(e.evidence.length).toBeGreaterThan(0);
      expect(e.steps.length).toBeGreaterThan(0);
      for (const st of e.steps) expect(html).toContain(st);
      for (const r of e.evidence) {
        expect(html).toContain(r.measured);
        expect(r.bar.min).toBeLessThanOrEqual(Math.min(r.bar.lo, r.bar.value));
        expect(r.bar.max).toBeGreaterThanOrEqual(Math.max(r.bar.hi, r.bar.value));
      }
    }
    expect(ex[0].evidence[0]).toMatchObject({ measured: '−18.3 dB', expected: '−30.0 dB … −24.0 dB', out: 'above' });
    expect(ex[0].steps).toEqual(['High-pass at 30 Hz, 24 dB/oct', 'EQ bell −3 dB at 40 Hz, Q 1']);
    expect(ex[3].evidence[0]).toMatchObject({ measured: '39%', expected: 'under 35%', out: 'above' });
    expect(html.match(/data-testid="example-card"/g) ?? []).toHaveLength(4);
  });

  it('skips an example whose finding is missing instead of crashing', () => {
    expect(buildExamples([])).toEqual([]);
  });

  it('credits the demo track', () => {
    expect(html).toContain(
      'Examples from SPECTR’s analysis of the demo track “Magnetic Fields” by Artifact303 (1:14 excerpt), used only as a demo.',
    );
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
