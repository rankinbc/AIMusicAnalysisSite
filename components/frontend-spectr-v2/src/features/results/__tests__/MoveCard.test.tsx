import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MoveCard } from '../MoveCard';
import type { Move } from '../move-model';

// Static-markup render (jsdom-free, story 1.7 pattern). Covers the lead-with-
// directive layout, confidence-gated steps, param highlighting, and triage label.

function makeMove(over: Partial<Move> = {}): Move {
  return {
    id: 'm1',
    title: 'Pull the master back to streaming level',
    group: 'quick',
    sev: 'warn',
    scope: 'Master bus',
    directive: 'Lower the limiter ceiling to -3 dB and land at -14 LUFS.',
    directional: 'Bring the overall level down toward streaming target.',
    steps: [{ where: 'limiter', detail: 'ceiling_db=-3' }],
    hasParams: true,
    why: 'You are 3 dB hotter than the platform target.',
    evidence: { type: 'meter', metric: 'Integrated: -11.2 LUFS', chartType: 'loudness' },
    confidence: 0.96,
    impact: 38,
    source: 'rule engine',
    isRule: true,
    specialist: null,
    status: 'suggested',
    verdictId: null,
    ...over,
  };
}

const noop = () => {};

describe('MoveCard', () => {
  it('leads with the directive, highlights measured params, shows confidence', () => {
    const html = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} onAudition={noop} />,
    );
    expect(html).toContain('Pull the master back to streaming level');
    expect(html).toContain('Master bus');
    expect(html).toContain('96% conf');
    // numeric tokens wrapped as mono params
    expect(html).toMatch(/<code[^>]*>-3 dB<\/code>/);
    expect(html).toMatch(/<code[^>]*>-14 LUFS<\/code>/);
  });

  it('marks rule-engine provenance with a RULE chip (not an AI persona)', () => {
    const html = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} onAudition={noop} />,
    );
    expect(html).toContain('RULE');
  });

  it('renders a finding number, AI persona group, and impact tag for specialist Moves', () => {
    const html = renderToStaticMarkup(
      <MoveCard
        move={makeMove({ isRule: false, specialist: 'low_end', impact: 82, verdictId: 'v1' })}
        rank={3}
        onToggleCommit={noop}
        onAudition={noop}
      />,
    );
    expect(html).toContain('Finding #03');
    expect(html).toContain('Spectrum'); // low_end specialist's group label
    expect(html).toContain('HIGH IMPACT'); // impact 82 → high band
    expect(html).not.toContain('RULE');
  });

  it('renders the structured steps when params back the fix', () => {
    const html = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} onAudition={noop} />,
    );
    expect(html).toContain('ceiling_db=-3');
  });

  it('renders directional prose and no steps when the fix has no params', () => {
    const html = renderToStaticMarkup(
      <MoveCard
        move={makeMove({ hasParams: false, steps: [] })}
        onToggleCommit={noop}
        onAudition={noop}
      />,
    );
    expect(html).toContain('Bring the overall level down toward streaming target.');
    expect(html).not.toContain('ceiling_db');
  });

  it('shows the triage label by commit status', () => {
    const suggested = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} onAudition={noop} />,
    );
    expect(suggested).toContain('+ Add to plan');

    const committed = renderToStaticMarkup(
      <MoveCard move={makeMove({ status: 'committed' })} onToggleCommit={noop} onAudition={noop} />,
    );
    expect(committed).toContain('✓ In plan');
  });
});
