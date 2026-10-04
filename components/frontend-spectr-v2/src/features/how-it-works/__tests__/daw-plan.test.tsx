// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { SAMPLE_FINDINGS, SAMPLE_META } from '../../landing/sample/sample-data';
import { DEMO_CHAIN, DEMO_CHAIN_RAW, DEMO_DROPPED, DEMO_EQ_BANDS } from '../daw-chain';
import { buildExamplePlan, EXAMPLE_NOTES, EXAMPLE_TRACKS } from '../example-session';
import { HowItWorksPage } from '../HowItWorksPage';

afterEach(() => {
  cleanup();
});

describe('"Take it back to your DAW" (/trust/how-its-built)', () => {
  const html = renderToStaticMarkup(<HowItWorksPage />);
  const start = html.indexOf('data-testid="daw-plan"');
  const section = html.slice(start, html.indexOf('data-testid="workflow-next"'));

  it('is the step after hearing the fixes and before the next version', () => {
    expect(start).toBeGreaterThan(html.indexOf('data-testid="workflow-listen"'));
    expect(start).toBeLessThan(html.indexOf('data-testid="workflow-next"'));
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
    expect(DEMO_CHAIN_RAW).toEqual({ eqFreqHz: 300, limiterCeilingDb: -1, trimDb: -5.13, measuredLufs: -8.9, crestFactorDb: 10.1 });
    expect(DEMO_EQ_BANDS).toEqual([{ n: 1, type: 'bell', freqHz: 300, gainDb: -3.96, q: 1 }]);
    // The mud cut in the demo report is the same −3.96 dB bell at 300 Hz.
    const mud = SAMPLE_FINDINGS.find((f) => f.verdict.specialist === 'rule_engine.mud_buildup')!;
    expect(mud.verdict.fix?.dsp_chain?.[0]).toMatchObject({ type: 'peaking_eq', params: { frequency_hz: DEMO_CHAIN_RAW.eqFreqHz } });
    expect(Math.round(Number(mud.verdict.fix?.dsp_chain?.[0]?.params?.gain_db) * 100) / 100).toBe(-3.96);
    const hintDevices = SAMPLE_FINDINGS.map((f) => (f.verdict.fix?.ableton_hint as { device?: string } | null | undefined)?.device);
    for (const d of ['EQ Eight', 'Limiter']) expect(hintDevices).toContain(d);
    // Measured loudness / crest quoted on the cards match the demo report.
    expect(SAMPLE_META.lufs).toBe(DEMO_CHAIN_RAW.measuredLufs);
    expect(SAMPLE_META.crestFactorDb).toBe(DEMO_CHAIN_RAW.crestFactorDb);
    expect(DEMO_CHAIN.find((d) => d.id === 'trim')!.why).toContain('−8.9 LUFS');
    expect(Math.round((DEMO_CHAIN_RAW.measuredLufs + DEMO_CHAIN_RAW.trimDb) * 10) / 10).toBe(-14);
  });

  it('shows the move the Coach Mix weighed and left out', () => {
    expect(section).toContain('data-device="dropped"');
    expect(section).toContain(DEMO_DROPPED.device);
    expect(section).toContain('10.1 dB crest factor');
  });

  it('draws the EQ card with the computed EQ device', () => {
    const { container } = render(<HowItWorksPage />);
    const eq = container.querySelector('[data-testid="daw-plan"] [data-device="eq"]')!;
    expect(eq.querySelector('svg path')).toBeTruthy();
    expect(eq.textContent).toContain('300 Hz');
  });

  it('shows per-track chains for an example session with stems, as well as the master', () => {
    for (const t of EXAMPLE_TRACKS) {
      expect(section).toContain(`data-lane="${t.role}"`);
      expect(section).toContain(t.track);
      for (const d of t.devices) expect(section).toContain(d.daw);
    }
    expect(EXAMPLE_TRACKS.map((t) => t.track)).toEqual(['Kick', 'Sub Bass', 'Pad Chords']);
    // The made-up lanes are labelled as an example; the master chain stays the real one.
    expect(section.indexOf('data-lane="kick"')).toBeLessThan(section.indexOf('data-device="eq"'));
    expect(section).toContain('A session with stems and an Ableton project');
  });

  it('carries plan notes that are not tied to a track or the master', () => {
    expect(EXAMPLE_NOTES.length).toBeGreaterThanOrEqual(3);
    for (const n of EXAMPLE_NOTES) expect(section).toContain(n.title);
  });

  it('shows the whole plan file, produced by the real DAW Plan export generator', () => {
    const { filename, content: md } = buildExamplePlan();
    expect(filename).toBe('daw-plan-night-drive.md');
    expect(md.startsWith('# Mixing plan — Night Drive v2')).toBe(true);
    expect(md).toContain('## Moves · by signal chain');
    // Track-scoped moves, the master, then notes with no scope and no device steps.
    expect(md).toContain('1. [ ] **Clear the kick’s rumble and boxiness** (Kick)');
    expect(md).toContain('2. [ ] **Duck the bass under the kick** (Sub Bass)');
    expect(md).toContain('sidechain: `source=Kick, ratio=4, attack_ms=5, release_ms=120`');
    expect(md).toContain('4. [ ] **Set the master ceiling and loudness** (Master)');
    expect(md).toContain('5. [ ] **Check the mix in mono before you bounce**\n');
    expect(md).not.toContain('Streaming targets');
    const { container } = render(<HowItWorksPage />);
    expect(container.querySelector('[data-testid="daw-plan-excerpt"]')!.textContent).toBe(md);
    expect(container.textContent).toContain('daw-plan-night-drive.md');
  });

  it('ends by sending you back with the next version', () => {
    expect(section).toContain('upload it as the');
    expect(section).toContain('next version of the same song');
  });
});
