import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MoveCard } from '../MoveCard';
import type { Move } from '../move-model';

// Static-markup render (jsdom-free, story 1.7 pattern). Covers the prototype
// move-card layout: problem kicker, directive with highlighted params, the
// source chip, the collapsed expand toggles, and the Add/Added rack toggle.

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
    ops: [{ type: 'limiter', params: { ceiling_db: -3 } }],
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
  it('leads with the title + scope, highlights measured params, shows confidence', () => {
    const html = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} />,
    );
    expect(html).toContain('Pull the master back to streaming level');
    expect(html).toContain('Master bus');
    expect(html).toContain('96%');
    // numeric tokens wrapped as params
    expect(html).toMatch(/<span class="param">-3 dB<\/span>/);
    expect(html).toMatch(/<span class="param">-14 LUFS<\/span>/);
  });

  it('marks rule-engine provenance on the source chip (no AI tint)', () => {
    const html = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} />,
    );
    expect(html).toContain('rule engine');
    expect(html).not.toContain('move-src ai');
  });

  it('tints the source chip for AI specialist Moves', () => {
    const html = renderToStaticMarkup(
      <MoveCard
        move={makeMove({ isRule: false, specialist: 'low_end', source: 'Low End', verdictId: 'v1' })}
        onToggleCommit={noop}
      />,
    );
    expect(html).toContain('move-src ai');
    expect(html).toContain('Low End');
  });

  it('offers a "suggested fix" toggle when params back the fix', () => {
    const html = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} />,
    );
    expect(html).toContain('suggested fix');
    // steps live behind the toggle — not in the collapsed markup
    expect(html).not.toContain('ceiling_db=-3');
  });

  it('renders directional prose and no fix toggle when the fix has no params', () => {
    const html = renderToStaticMarkup(
      <MoveCard
        move={makeMove({ hasParams: false, steps: [] })}
        onToggleCommit={noop}
      />,
    );
    expect(html).toContain('Bring the overall level down toward streaming target.');
    expect(html).not.toContain('suggested fix');
  });

  it('shows the rack toggle label by commit status', () => {
    const suggested = renderToStaticMarkup(
      <MoveCard move={makeMove()} onToggleCommit={noop} />,
    );
    expect(suggested).toContain('+ Add');

    const committed = renderToStaticMarkup(
      <MoveCard move={makeMove({ status: 'committed' })} onToggleCommit={noop} />,
    );
    expect(committed).toContain('✓ Added');
  });
});
