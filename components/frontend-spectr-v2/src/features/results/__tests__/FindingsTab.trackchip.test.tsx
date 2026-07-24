import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FindingsTab } from '../FindingsTab';

// Renders to static markup (results-tab jsdom-free pattern). FR12: verdicts with
// where.track_names show the named tracks as chips inside the finding text.
function makeVerdict(over: Partial<VerdictDto> = {}): VerdictDto {
  return {
    id: 'v1',
    analysisId: 'a1',
    specialist: 'rule_engine.robotic_velocity',
    promptVersion: '1',
    model: 'test',
    severity: 'critical',
    category: 'humanization',
    confidence: 0.9,
    priorityScore: 70,
    impact: null,
    chartType: null,
    headline: 'Robotic velocities (SUB-DEEP)',
    summary: 'SUB-DEEP has near-zero velocity variation.',
    body: null,
    metricLine: null,
    whyItMatters: 'Identical velocities read as programmed.',
    presetName: null,
    evidence: null,
    fix: null,
    sources: null,
    problemId: null,
    kind: 'fault',
    source: 'rule_engine',
    dataTier: 'project_midi',
    fixable: true,
    suspected: false,
    where: { track_names: ['SUB-DEEP'] },
    refines: null,
    createdAt: '2026-06-27T00:00:00Z',
    userState: { dismissed: false, applied: false, feedback: null },
    ...over,
  };
}

describe('FindingsTab track-name chips (FR12)', () => {
  it('wraps an attributed track name in a chip button when onTrackActivate is provided', () => {
    const html = renderToStaticMarkup(
      <FindingsTab
        verdicts={[makeVerdict()]}
        onGoToActions={() => {}}
        onTrackActivate={() => {}}
      />,
    );
    // The track name renders inside a <button> (the clickable chip), not as bare text.
    expect(html).toMatch(/<button[^>]*>SUB-DEEP<\/button>/);
  });

  it('renders plain text (no chip) when the verdict has no track attribution', () => {
    const html = renderToStaticMarkup(
      <FindingsTab
        verdicts={[makeVerdict({ where: null, headline: 'Loudness war', summary: 'Crushed.' })]}
        onGoToActions={() => {}}
        onTrackActivate={() => {}}
      />,
    );
    expect(html).toContain('Loudness war');
    expect(html).not.toMatch(/<button[^>]*>Loudness war<\/button>/);
  });

  it('does not chip-link when no onTrackActivate handler is wired', () => {
    const html = renderToStaticMarkup(
      <FindingsTab verdicts={[makeVerdict()]} onGoToActions={() => {}} />,
    );
    expect(html).toContain('SUB-DEEP');
    expect(html).not.toMatch(/<button[^>]*>SUB-DEEP<\/button>/);
  });
});

describe('FindingsTab suspected flag (item 6)', () => {
  it('renders an "Unverified" chip when suspected is true', () => {
    const html = renderToStaticMarkup(
      <FindingsTab
        verdicts={[makeVerdict({ suspected: true })]}
        onGoToActions={() => {}}
      />,
    );
    expect(html).toContain('Unverified');
    expect(html).toMatch(/class="src suspected"/);
  });

  it('does not render the "Unverified" chip when suspected is false', () => {
    const html = renderToStaticMarkup(
      <FindingsTab verdicts={[makeVerdict({ suspected: false })]} onGoToActions={() => {}} />,
    );
    expect(html).not.toContain('Unverified');
  });
});
