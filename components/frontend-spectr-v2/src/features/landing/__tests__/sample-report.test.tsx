// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import SampleReport from '../sample/SampleReport';
import { SAMPLE_FINDINGS, SAMPLE_META } from '../sample/sample-data';
import { describeOp, isWin, planSteps, teamOf } from '../sample/sample-model';

afterEach(cleanup);

const issues = SAMPLE_FINDINGS.filter((f) => !isWin(f));
const wins = SAMPLE_FINDINGS.filter(isWin);

describe('sample fixture (generated from the demo snapshot)', () => {
  it('is the curated demo report (real analyzer output), credited to the artist', () => {
    expect(SAMPLE_META.title).toBe('Magnetic Fields — Artifact303');
    expect(SAMPLE_META.credit).toMatch(/Artifact303/);
    expect(SAMPLE_META.credit).toMatch(/only as a SPECTR demo/);
    expect(issues.length).toBeGreaterThanOrEqual(10);
    expect(wins.length).toBeGreaterThan(0);
    expect(planSteps(SAMPLE_FINDINGS).length).toBeGreaterThanOrEqual(5);
    // Every finding rests on measured evidence.
    for (const f of SAMPLE_FINDINGS) {
      expect(Array.isArray(f.verdict.evidence)).toBe(true);
      expect((f.verdict.evidence as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('credits a team of specialists plus the measurement engine', () => {
    const team = teamOf(SAMPLE_FINDINGS);
    expect(team.filter((t) => !t.isRule).length).toBeGreaterThanOrEqual(4);
    expect(team.some((t) => t.isRule)).toBe(true);
  });

  it('carries no coach conversation or user-authored text', () => {
    const blob = JSON.stringify({ SAMPLE_META, SAMPLE_FINDINGS });
    for (const banned of ['conversation', 'rackPresets', 'file_path', 'audioKey', 'userText', '"role"']) {
      expect(blob).not.toContain(banned);
    }
  });
});

describe('describeOp — plain DAW instructions from dsp ops', () => {
  it('formats the common ops', () => {
    expect(describeOp({ type: 'peaking_eq', params: { frequency_hz: 320, gain_db: -2.5, q: 1 } })).toBe(
      'EQ bell −2.5 dB at 320 Hz, Q 1',
    );
    expect(describeOp({ type: 'high_shelf', params: { frequency_hz: 10000, gain_db: 3 } })).toBe(
      'High shelf +3 dB at 10 kHz',
    );
    expect(describeOp({ type: 'high_pass', params: { frequency_hz: 30, slope_db: 24 } })).toBe(
      'High-pass at 30 Hz, 24 dB/oct',
    );
  });

  it('never drops an unknown op', () => {
    expect(describeOp({ type: 'tape_wobble', params: { depth: 2 } })).toBe('tape_wobble: depth=2');
    expect(describeOp({ type: 'mystery', params: {} })).toBe('mystery');
  });
});

describe('<SampleReport /> (landing live sample)', () => {
  it('shows the demo-track credit and demo-use disclaimer under the title', () => {
    render(<SampleReport />);
    expect(screen.getByText(/All rights belong to the artist/)).toBeTruthy();
  });

  it('renders every finding with severity, group and who raised it', () => {
    render(<SampleReport />);
    const rows = screen.getAllByTestId('sample-finding');
    expect(rows).toHaveLength(issues.length);
    for (const f of issues) expect(screen.getByText(f.verdict.headline)).toBeTruthy();
    expect(screen.getAllByText(/Stereo Phase|Loudness|Low End/).length).toBeGreaterThan(0);
  });

  it('expands a finding to its evidence and concrete fix steps', () => {
    render(<SampleReport />);
    const target = issues.find((f) => (f.verdict.fix?.dsp_chain?.length ?? 0) > 0 && f !== issues[0])!;
    const row = screen
      .getAllByTestId('sample-finding')
      .find((li) => li.textContent?.includes(target.verdict.headline))!;
    const btn = within(row).getByRole('button', { expanded: false });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(row).getByText('The fix')).toBeTruthy();
    expect(within(row).getByText('The data')).toBeTruthy();
    const first = describeOp(target.verdict.fix!.dsp_chain![0]!);
    expect(within(row).getAllByText(first).length).toBeGreaterThan(0);
  });

  it('shows the prioritised fix plan', () => {
    render(<SampleReport />);
    fireEvent.click(screen.getByRole('tab', { name: /Fix plan/ }));
    const plan = screen.getByTestId('sample-plan');
    const steps = planSteps(SAMPLE_FINDINGS);
    expect(plan.querySelectorAll(':scope > li')).toHaveLength(steps.length);
    expect(within(plan).getByText(steps[0]!.verdict.headline)).toBeTruthy();
    // Highest priority first.
    const scores = steps.map((p) => p.verdict.priorityScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('plain-English toggle adds the why-it-matters line under each row', () => {
    render(<SampleReport />);
    const why = issues[1]!.verdict.whyItMatters!;
    expect(screen.queryAllByText(why)).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Plain English'));
    expect(screen.getAllByText(why).length).toBeGreaterThan(0);
  });

  it('has no account-only controls and no authenticated calls', () => {
    const { container } = render(<SampleReport />);
    const text = container.textContent ?? '';
    for (const banned of ['Mark applied', 'Ignore', 'Send to Listen', 'Show Suggested Fix', 'Ask the coach about this']) {
      expect(text).not.toContain(banned);
    }
  });

  it('passes axe WCAG 2.1 AA (color contrast excluded — jsdom has no paint)', async () => {
    const { container } = render(<SampleReport />);
    const results = await axeRun(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
