// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { run as axeRun } from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { responseDb } from '../../landing/eq-response';
import { SAMPLE_FINDINGS, SAMPLE_META } from '../../landing/sample/sample-data';
import { GLOSSARY } from '../../results/glossary-terms';
import { EVIDENCE_FINDING, FEATURES, FIX_DETAIL, HEAR_FIXES, LEARN_FINDING, LIMITER_FIX } from '../features-content';
import { SAMPLE_SPECIALISTS_RUN, SAMPLE_SPECIALIST_FINDINGS, SAMPLE_STATS } from '../vignette-data';
import { DawPlanVignette, DeeperVignette, LibraryVignette } from '../vignettes/WorkflowVignettes';
import { FeaturesPage } from '../FeaturesPage';
import { HearItVignette } from '../vignettes/HearItVignette';
import { LearnVignette } from '../vignettes/LearnVignette';

// Static renders (the landing idiom: plain <a> anchors, so no RouterProvider;
// effects don't run, so nothing is fetched or captured).

const verdict = (headline: string) => {
  const hit = SAMPLE_FINDINGS.find((f) => f.verdict.headline === headline);
  if (!hit) throw new Error(`not in the sample report: ${headline}`);
  return hit.verdict;
};

describe('FeaturesPage', () => {
  const html = renderToStaticMarkup(<FeaturesPage />);

  it('renders every feature, each lead vignette, and both funnel CTAs', () => {
    for (const f of FEATURES) {
      expect(html).toContain(f.head);
      expect(html).toContain(`id="${f.id}"`);
      expect(html).toContain(`href="#${f.id}"`);
    }
    // Made-up example values are never passed off as the sample report.
    const illustrations = FEATURES.filter((f) => f.sample === false);
    expect(illustrations.map((f) => f.id)).toEqual(['learn', 'library', 'deeper', 'reference']);
    expect(html.match(/>illustration</g)?.length).toBe(illustrations.length);
    expect(html.match(/>sample report</g)?.length).toBe(FEATURES.length - illustrations.length);
    expect(html).toMatch(/<a href="\/analyze"[^>]*data-testid="features-cta"/);
    expect(html).toMatch(/<a href="\/demo"[^>]*data-testid="features-demo-cta"/);
    expect(html).toContain('href="/register"');
    // One Features link in the chrome, one in the footer.
    expect(html.match(/href="\/features"/g)?.length).toBe(2);
    expect(html).toContain('Library and version tracking');
  });

  it('uses no streaming-platform example', () => {
    expect(html).not.toMatch(/streaming|spotify|apple music|youtube/i);
  });

  it('sells the fixing, never a grade', () => {
    expect(html).not.toMatch(/\bgraded?\b/i);
    expect(html).not.toMatch(/hit potential|\/100/i);
    // The one allowed "score": the generic contrast line in the hero.
    expect(html.match(/\bscores?\b/gi)?.length).toBe(1);
  });

  it('makes no arrangement promise and names no tier for stems or .als', () => {
    expect(html).not.toMatch(/arrangement|structure/i);
    expect(html).not.toMatch(/\bPro\b/);
  });
});

describe('vignette excerpts match the sample report', () => {
  it.each(HEAR_FIXES.map((f) => [f.headline, f] as const))('%s', (headline, fix) => {
    const chain = verdict(headline).fix?.dsp_chain ?? [];
    expect(chain).toHaveLength(fix.bands.length);
    fix.bands.forEach((b, i) => {
      const op = chain[i]!;
      const p = op.params ?? {};
      expect(p.frequency_hz).toBe(b.freqHz);
      if (b.type === 'high_pass') {
        expect(op.type).toBe('high_pass');
        expect(p.slope_db).toBe(b.slopeDb);
      } else {
        expect(op.type).toBe(b.type === 'bell' ? 'peaking_eq' : 'high_shelf');
        expect(p.gain_db).toBe(b.gainDb);
        expect(p.q).toBe(b.q);
      }
    });
  });

  it('the limiter fix', () => {
    const fix = verdict(LIMITER_FIX.finding).fix;
    expect(fix?.dsp_chain?.[0]).toEqual({
      type: 'limiter',
      params: { ceiling_db: -1, release_ms: 100, lookahead_ms: 5, threshold_db: -3 },
    });
    expect(fix?.expected_outcome).toBe(LIMITER_FIX.outcome);
  });

  it('the evidence rows and why-it-matters', () => {
    const v = verdict('Excessive sub-bass will overwhelm small speakers');
    expect(v.whyItMatters).toBe(EVIDENCE_FINDING.why);
    expect(Math.round((v.confidence ?? 0) * 100)).toBe(EVIDENCE_FINDING.confidencePct);
    expect(v.priorityScore).toBe(EVIDENCE_FINDING.priority);
    expect(v.severity).toBe(FIX_DETAIL.severity);
    expect(v.category).toBe(FIX_DETAIL.category.toLowerCase());
    // The fix detail prints the dsp_chain's raw op names + params.
    expect(FIX_DETAIL.ops.map((op) => ({ type: op.type, params: Object.fromEntries(op.params.map(([key, val]) => [key, Number(val)])) })))
      .toEqual(v.fix?.dsp_chain?.map((op) => ({ type: op.type, params: op.params })));
    const evidence = (v.evidence ?? []) as { label: string; value: number | null; expected_range: number[] | null }[];
    for (const row of EVIDENCE_FINDING.rows) {
      const ev = evidence.find((e) => e.label === row.label);
      expect(Number(ev?.value).toFixed(1)).toBe(row.value.toFixed(1));
      expect(ev?.expected_range).toEqual([...row.range]);
    }
  });

  it('every Learn term has a glossary definition', () => {
    const defined = new Set(GLOSSARY.map(([term]) => term));
    for (const term of LEARN_FINDING.terms) expect(defined.has(term)).toBe(true);
  });

  it('the track-analysis stats and the specialists that ran', () => {
    expect(SAMPLE_META.lufs).toBe(SAMPLE_STATS.lufs);
    expect(SAMPLE_META.truePeakDb).toBe(SAMPLE_STATS.truePeakDb);
    expect(SAMPLE_META.crestFactorDb).toBe(SAMPLE_STATS.crestFactorDb);
    expect(SAMPLE_META.loudnessRangeLu).toBe(SAMPLE_STATS.loudnessRangeLu);
    expect(SAMPLE_META.stereoCorrelation).toBe(SAMPLE_STATS.stereoCorrelation);
    expect(SAMPLE_META.key).toBe(SAMPLE_STATS.key);
    expect(SAMPLE_META.specialistsRun).toEqual([...SAMPLE_SPECIALISTS_RUN]);
    for (const slug of SAMPLE_SPECIALISTS_RUN) {
      expect(SAMPLE_FINDINGS.filter((f) => f.verdict.specialist === slug).length).toBe(SAMPLE_SPECIALIST_FINDINGS[slug]);
    }
  });
});

describe('interactive vignettes', () => {
  it('DAW plan: ticking a move updates the count', () => {
    render(<DawPlanVignette />);
    expect(screen.getByText('1 of 4 done')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Missing air and sparkle/ }));
    expect(screen.getByText('2 of 4 done')).toBeTruthy();
  });

  it('library: switching decks', () => {
    render(<LibraryVignette />);
    const a = screen.getByRole('button', { name: 'Deck A, v2' });
    expect(a.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(a);
    expect(a.getAttribute('aria-pressed')).toBe('true');
  });

  it('go deeper: each input shows what it unlocks', () => {
    render(<DeeperVignette />);
    expect(screen.getByText('6 stems · roles detected')).toBeTruthy();
    expect(screen.getByText('Upload & analyze')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Stems' }));
    expect(screen.getByText('Per-stem finding')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Ableton project' }));
    expect(screen.getByText('Fix, on your track')).toBeTruthy();
  });
});

describe('high-shelf response', () => {
  const shelf = [{ n: 1, type: 'high_shelf', freqHz: 10000, gainDb: 3, q: 0.7 }] as const;
  it('lifts the top by the shelf gain and leaves the lows alone', () => {
    expect(responseDb(shelf, 20000)).toBeCloseTo(3, 0);
    expect(Math.abs(responseDb(shelf, 100))).toBeLessThan(0.1);
  });
});

describe('HearItVignette', () => {
  it('switches fixes and bypass', () => {
    render(<HearItVignette />);
    expect(screen.getByText('1/13 modules on')).toBeTruthy();
    expect(screen.getByText('With 3 fixes applied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Missing air and sparkle/ }));
        expect(screen.getByText('With 2 fixes applied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bypass' }));
    expect(screen.getByText('Original mix')).toBeTruthy();
  });
});

describe('LearnVignette', () => {
  it('shows the definition of the chosen term', () => {
    render(<LearnVignette />);
    expect(screen.getByText(/Ducking one sound whenever another plays/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'headroom' }));
    expect(screen.getByText(/Spare space between your loudest peak/)).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('has no axe violations (WCAG 2.1 AA, contrast off — jsdom has no paint)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const { container } = render(<FeaturesPage />);
    const results = await axeRun(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    vi.unstubAllGlobals();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`)).toEqual([]);
  }, 20_000);
});
