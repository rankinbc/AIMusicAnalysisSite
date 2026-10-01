// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { SAMPLE_FINDINGS, SAMPLE_META } from '../../landing/sample/sample-data';
import { DEMO_CHAIN, DEMO_CHAIN_RAW, DEMO_DROPPED, DEMO_EQ_BANDS } from '../daw-chain';
import { buildPlanExcerpt } from '../daw-plan-excerpt';
import { HowItWorksPage } from '../HowItWorksPage';

afterEach(() => {
  cleanup();
});

describe('"Take it back to your DAW" (/trust/how-its-built)', () => {
  const html = renderToStaticMarkup(<HowItWorksPage />);
  const start = html.indexOf('data-testid="daw-plan"');
  const section = html.slice(start, html.indexOf('See it for yourself'));

  it('closes the page: after "What makes it different", right before the CTA', () => {
    expect(start).toBeGreaterThan(html.indexOf('What makes it different'));
    expect(start).toBeLessThan(html.indexOf('See it for yourself'));
    expect(section).toContain('Take it back to your DAW');
  });

  it('describes the DAW Plan and Coach Mix truthfully', () => {
    for (const t of [
      'doesn’t leave you with a list',
      'a plan to take back to your DAW',
      'exact settings',
      'Markdown or plain text',
      'grouped per device',
      'Coach Mix',
      'one chain',
      '+6 dB',
      '−9 dB',
      '4:1',
      'Listen rack',
    ]) {
      expect(section).toContain(t);
    }
  });

  it('renders every device card, in signal order, with its parameters', () => {
    expect(DEMO_CHAIN.map((d) => d.daw)).toEqual(['EQ Eight', 'Limiter', 'Utility']);
    const positions = DEMO_CHAIN.map((d) => section.indexOf(`data-device="${d.id}"`));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const d of DEMO_CHAIN) {
      expect(section).toContain(d.daw);
      expect(section).toContain(`rack: ${d.module}`);
      for (const p of d.params) {
        expect(section).toContain(`<dt>${p.label}</dt>`);
        expect(section).toContain(p.value);
      }
    }
    expect(section).toContain('The final chain SPECTR built for the demo track (master bus)');
  });

  // Values hand-copied from the production Coach Mix snapshot (see daw-chain.ts).
  it('pins the chain to the snapshot values and to the demo data where they overlap', () => {
    expect(DEMO_CHAIN_RAW).toEqual({ highPassHz: 30, limiterCeilingDb: -1, trimDb: -1.76, measuredLufs: -12.2, crestFactorDb: 10.4 });
    expect(DEMO_EQ_BANDS).toEqual([{ n: 1, type: 'high_pass', freqHz: 30, slopeDb: 12 }]);
    // The rumble fix in the demo report is the same 30 Hz high-pass, on EQ Eight.
    const rumble = SAMPLE_FINDINGS.find((f) => f.verdict.problemId === 'low_end.sub_rumble.0')!;
    expect(rumble.verdict.fix?.dsp_chain?.[0]).toMatchObject({ type: 'high_pass', params: { frequency_hz: DEMO_CHAIN_RAW.highPassHz } });
    const hintDevices = SAMPLE_FINDINGS.map((f) => (f.verdict.fix?.ableton_hint as { device?: string } | null | undefined)?.device);
    for (const d of ['EQ Eight', 'Utility', DEMO_DROPPED.device]) expect(hintDevices).toContain(d);
    // Measured loudness / crest quoted on the cards match the demo report.
    expect(SAMPLE_META.lufs).toBe(DEMO_CHAIN_RAW.measuredLufs);
    expect(SAMPLE_META.crestFactorDb).toBe(DEMO_CHAIN_RAW.crestFactorDb);
    expect(DEMO_CHAIN.find((d) => d.id === 'trim')!.why).toContain('−12.2 LUFS');
    expect(Math.round((DEMO_CHAIN_RAW.measuredLufs + DEMO_CHAIN_RAW.trimDb) * 10) / 10).toBe(-14);
  });

  it('shows the move the Coach Mix weighed and left out', () => {
    expect(section).toContain('data-device="dropped"');
    expect(section).toContain(DEMO_DROPPED.device);
    expect(section).toContain('10.4 dB crest factor');
  });

  it('draws the EQ card with the computed EQ device', () => {
    const { container } = render(<HowItWorksPage />);
    const eq = container.querySelector('[data-testid="daw-plan"] [data-device="eq"]')!;
    expect(eq.querySelector('svg path')).toBeTruthy();
    expect(eq.textContent).toContain('High-pass');
    expect(eq.textContent).toContain('12 dB/oct');
  });

  it('shows an excerpt produced by the real DAW Plan export generator', () => {
    const md = buildPlanExcerpt();
    expect(md.startsWith('# Mixing plan — Demo track')).toBe(true);
    expect(md).toContain('## Moves · by signal chain');
    expect(md).toContain('1. [ ] **Excessive sub-bass energy overwhelming the mix** (Master)');
    expect(md).toContain('high_pass: `q=0.70, slope_db=24, frequency_hz=30`');
    expect(md).toContain('peaking_eq: `q=1, gain_db=-3, frequency_hz=40`');
    expect(md).toContain('stereo_width: `width_pct=130`');
    expect(md).not.toContain('Streaming targets');
    const { container } = render(<HowItWorksPage />);
    expect(container.querySelector('[data-testid="daw-plan-excerpt"]')!.textContent).toBe(md);
  });
});
