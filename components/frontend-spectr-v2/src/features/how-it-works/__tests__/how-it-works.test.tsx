// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { COACH_INTRO, DEMO_ANSWER, DEMO_EVIDENCE, DEMO_QUESTION } from '../coach-showcase-content';
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
      'Meet the Coach',
      'From upload to a plan',
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
    expect(html).toContain('score and a list of problems');
    expect(html).toContain('Your audio never trains a model');
  });

  it('links both CTAs to the right funnels', () => {
    expect(html).toMatch(/<a href="\/demo"[^>]*data-testid="hiw-demo-cta"[^>]*>See it on a real track/);
    expect(html).toMatch(/<a href="\/analyze"[^>]*data-testid="hiw-analyze-cta"[^>]*>Analyze your track free/);
  });

  it('names no other product', () => {
    expect(html).not.toMatch(/trackscore|landr|ozone|izotope|mixcheck|bandlab|emastered|cryo|mixed in key|sonible|mastering\.com/i);
  });

  it('renders the pipeline diagram as an accessible image, in wide and narrow layouts', () => {
    const { container } = render(<HowItWorksPage />);
    // The Coach avatar in the chat showcase sits inside aria-hidden.
    const imgs = [...container.querySelectorAll('svg[role="img"]')].filter((i) => !i.closest('[aria-hidden="true"]'));
    expect(imgs.map((i) => i.getAttribute('aria-label'))).toEqual([
      PIPELINE_TITLE,
      PIPELINE_TITLE,
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

  // Owner ruling 2026-10-01: show the pipeline, never the infrastructure —
  // no tech stack, hosting, CI, or repository details on the public page.
  it('exposes no infrastructure, tech stack or repository details', () => {
    expect(html).not.toMatch(
      /github|React 19|ASP\.NET|\.NET 10|PostgreSQL|Redis|Dramatiq|Caddy|Azure|Trivy|Docker|Prometheus|Grafana|Cloudflare|Under the hood/i,
    );
  });

  it('leads with helping you fix the mix, not just diagnosing it', () => {
    expect(html).toContain('leave the fixing');
    expect(html).toContain('It helps you fix it, not just find it');
  });

  it('example cards carry real demo verdicts: headline, evidence and fix steps', () => {
    const ex = buildExamples();
    expect(ex).toHaveLength(4);
    expect(ex.map((e) => e.verdict.headline)).toEqual([
      'Excessive sub-bass will overwhelm small speakers',
      'Missing air and sparkle (6-20kHz band very low)',
      'Master pushed too hot (-8.9 LUFS, peaks over)',
      'Master output clipping detected — 92 hard-clipped samples',
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
    expect(ex[0].evidence[0]).toMatchObject({ measured: '−20.0 dB', expected: '−30.0 dB … −24.0 dB', out: 'above' });
    expect(ex[0].steps).toEqual(['High-pass at 35 Hz, 24 dB/oct', 'EQ bell −2 dB at 50 Hz, Q 1.2']);
    expect(ex[2].evidence[0]).toMatchObject({ measured: '−8.9 LUFS', expected: '−17.0 LUFS … −11.0 LUFS', out: 'above' });
    expect(html.match(/data-testid="example-card"/g) ?? []).toHaveLength(4);
  });

  it('skips an example whose finding is missing instead of crashing', () => {
    expect(buildExamples([])).toEqual([]);
  });

  it('never names the demo song or its artist', () => {
    const { container } = render(<HowItWorksPage />);
    for (const text of [html, container.textContent ?? '']) {
      expect(text).not.toMatch(/Magnetic Fields|Artifact303|Velda|Melodic Mind/i);
    }
  });

  it('credits the demo track', () => {
    expect(html).toContain(
      'Examples from SPECTR’s analysis of the demo track (1:20 excerpt), used only as a demo.',
    );
  });

  it("stays clear of the guard suite's banned phrases", () => {
    expect(html).not.toMatch(/jobs? waiting|jobs? queued|queueDepth|\bfollowers\b|isPublic|\bshare\b|community/i);
  });

  describe('Meet the Coach showcase', () => {
    const start = html.indexOf('data-testid="coach-showcase"');
    const section = html.slice(start, html.indexOf('From upload to a plan'));

    it('sits after the worked examples and right before "From upload to a plan"', () => {
      expect(start).toBeGreaterThan(html.indexOf('data-testid="example-findings"'));
      expect(start).toBeLessThan(html.indexOf('From upload to a plan'));
      expect(section).toContain('Meet the Coach');
      expect(section).toContain('AI coach');
    });

    it('describes the coach truthfully: report-grounded, three modes, no audio', () => {
      for (const t of ['measurements and findings', 'Concise, Normal or Teach', 'not the audio']) {
        expect(section).toContain(t);
      }
    });

    it("shows the coach's intro and the real demo exchange with its evidence chips", () => {
      const plain = section.replace(/&#x27;/g, "'").replace(/’/g, "'");
      expect(plain).toContain(COACH_INTRO.replace(/’/g, "'"));
      expect(section).toContain(DEMO_QUESTION);
      expect(DEMO_ANSWER).toMatch(/^Sweep a parametric EQ through 200–500 Hz/);
      expect(plain).toContain(DEMO_ANSWER.replace(/’/g, "'"));
      expect(section).toContain('From the demo track');
      expect(DEMO_EVIDENCE.map((e) => e.label)).toEqual(['Low-mid 7.9 dB above mid', 'Low-mid −36.4 dB', 'Mid −44.3 dB']);
      for (const e of DEMO_EVIDENCE) expect(section).toContain(e.label);
    });

    it('is a replica of the real panel: header, modes, role labels, composer, meta line', () => {
      for (const t of ['Coach Chat', 'Concise', 'Normal', 'Teach', 'Knows your track and can answer questions and provide guidance', 'Coach Mix', 'Specialists', '>You<', '>Coach<', 'Ask the coach about this mix…', 'grounded']) {
        expect(section).toContain(t);
      }
    });

    it('headers the panel "Coach Chat" with the small Coach avatar right beside the title', () => {
      expect(section).not.toContain('Ask the Coach');
      expect(section).not.toContain('I know everything about this song.');
      const { container } = render(<HowItWorksPage />);
      const panel = container.querySelector('[data-testid="coach-showcase"]')!;
      const title = [...panel.querySelectorAll('span')].find((el) => el.textContent === 'Coach Chat')!;
      expect(title).toBeTruthy();
      const avatar = title.previousElementSibling!;
      expect(avatar.getAttribute('aria-hidden')).toBe('true');
      const svg = avatar.querySelector('svg')!;
      expect(svg).toBeTruthy();
      expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(24);
    });

    it('links to the demo and offers no textbox that accepts input', () => {
      expect(section).toMatch(/<a href="\/demo"[^>]*data-testid="hiw-coach-demo-cta"/);
      expect(section).toContain('Chat with the Coach in the demo');
      const { container } = render(<HowItWorksPage />);
      const panel = container.querySelector('[data-testid="coach-showcase"]')!;
      expect(panel.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]')).toHaveLength(0);
      expect(panel.querySelectorAll('button')).toHaveLength(0);
    });

    it('renders every message visibly when it cannot animate (no IntersectionObserver)', () => {
      const { container } = render(<HowItWorksPage />);
      const panel = container.querySelector('[data-testid="coach-showcase"]')!;
      expect(panel.querySelectorAll('[data-hidden]')).toHaveLength(0);
      expect(panel.textContent).toContain(DEMO_QUESTION);
    });
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
