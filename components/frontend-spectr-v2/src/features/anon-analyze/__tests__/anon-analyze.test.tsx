import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { JobResultsDto } from '../../../api/types';
import { AnonReportView, DropZoneView, ExplainerLine } from '../AnalyzePage';
import { type AnonReportVM, vmFromAnon, vmFromFull } from '../anon-report-vm';
import type { AnonReport } from '../useAnonAnalysis';

// Story 6.3 — static renders of the pure funnel pieces (the page state machine
// + register claim are exercised end-to-end by smoke-anon-funnel.spec.ts).

// The REDUCED anon payload (what the server actually sends locked): #1 finding
// + count only, phase-1 for streaming, no other findings/coach copy.
function anonReport(over: Partial<AnonReport> = {}): AnonReport {
  return {
    finalJson: {
      grade: 'D',
      overall_score: 51,
      danceability_score: 40,
      top_fixes: ['True peak is hitting 0.0 dBTP — keep it below −1.0 dBTP.'],
      phases: [{ phase: 1, name: 'Universal Mix Analysis', data: { lufs: -9.2, true_peak_db: 0.0 } }],
    },
    topFinding: 'True peak is hitting 0.0 dBTP — keep it below −1.0 dBTP.',
    totalFindings: 3,
    ...over,
  };
}

function fullResults(): JobResultsDto {
  return {
    jobId: 'j1', analysisId: 'a1', versionId: null, songId: null, songName: null,
    finalJson: {
      grade: 'D', overall_score: 51, danceability_score: 40,
      top_fixes: ['FIX ONE', 'FIX TWO', 'FIX THREE'],
      coach_intro: 'Full coach intro',
      phases: [{ phase: 1, name: 'Universal Mix Analysis', data: { lufs: -9.2 } }],
    },
  };
}

describe('DropZoneView (story 6.3 AC1 — UX-DR27)', () => {
  it('renders the full-bleed zone with mono hints and ZERO form fields', () => {
    const html = renderToStaticMarkup(<DropZoneView onFile={() => {}} error={null} />);
    expect(html).toContain('data-testid="anon-drop-zone"');
    expect(html).toContain('WAV · FLAC · MP3 · ≤250 MB');
    expect(html).toContain('Choose a file');
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain('type="email"');
    expect((html.match(/<input/g) ?? []).length).toBe(1);
    expect(html).toContain('type="file"');
  });

  it('surfaces an upload error with honest copy', () => {
    const html = renderToStaticMarkup(
      <DropZoneView onFile={() => {}} error="One analysis at a time — this device's previous one is still running." />,
    );
    expect(html).toContain('One analysis at a time');
  });
});

describe('ExplainerLine (AC2 — keyed to the current phase)', () => {
  it('shows the explainer for the CURRENT phase the worker reports', () => {
    const html = renderToStaticMarkup(<ExplainerLine currentPhase="Genre Detection" tick={0} />);
    expect(html).toContain('rotating-explainer');
    expect(html).toContain('Genre Detection');
    expect(html).toContain('which genre profile');
  });

  it('falls back to a gentle rotation before a phase name arrives', () => {
    const a = renderToStaticMarkup(<ExplainerLine currentPhase="" tick={0} />);
    const b = renderToStaticMarkup(<ExplainerLine currentPhase="" tick={1} />);
    expect(a).not.toEqual(b);
  });
});

describe('AnonReportView (AC3 — visible hero + gated depth)', () => {
  const lockedVm: AnonReportVM = vmFromAnon(anonReport());

  it('shows grade hero, #1 finding, and streaming readiness fully visible', () => {
    const html = renderToStaticMarkup(<AnonReportView vm={lockedVm} locked onUnlock={() => {}} />);
    expect(html).toContain('anon-report');
    expect(html).toMatch(/>D</);
    expect(html).toContain('#1 finding');
    expect(html).toContain('True peak is hitting 0.0 dBTP');
    expect(html).toContain('Streaming readiness');
  });

  it('locks with the AC3 reason copy + real count and NEVER renders withheld text', () => {
    const html = renderToStaticMarkup(<AnonReportView vm={lockedVm} locked onUnlock={() => {}} />);
    expect(html).toContain('Create a free account to keep this report + see all 3 findings.');
    expect(html).toContain('2 more findings behind the blur');
    // The reduced payload has no finding #2/#3 to leak — the blur is placeholders.
    expect(html).toContain('••••');
  });

  it('renders the FULL findings unlocked once claimed', () => {
    const html = renderToStaticMarkup(
      <AnonReportView vm={vmFromFull(fullResults())} locked={false} onUnlock={() => {}} />,
    );
    expect(html).not.toContain('Create a free account to keep this report');
    expect(html).toContain('FIX TWO');
    expect(html).toContain('FIX THREE');
    expect(html).toContain('Full coach intro');
  });

  it('tolerates a report with no findings (no #1 card, no blur, no crash)', () => {
    const vm = vmFromAnon(anonReport({
      finalJson: { grade: 'B', overall_score: 82, phases: [] },
      topFinding: null,
      totalFindings: 0,
    }));
    const html = renderToStaticMarkup(<AnonReportView vm={vm} locked onUnlock={() => {}} />);
    expect(html).toContain('anon-report');
    expect(html).not.toContain('#1 finding');
    expect(html).not.toContain('see all 0 findings');
  });
});
