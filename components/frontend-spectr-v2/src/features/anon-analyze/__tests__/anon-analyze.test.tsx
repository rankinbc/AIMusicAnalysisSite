import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { JobResultsDto } from '../../../api/types';
import { AnonReportView, DropZoneView, ExplainerLine } from '../AnalyzePage';

// Story 6.3 — static renders of the pure funnel pieces (the page state machine
// + register claim are exercised end-to-end by smoke-anon-funnel.spec.ts).

function results(over: Partial<JobResultsDto> = {}): JobResultsDto {
  return {
    jobId: 'j1',
    analysisId: 'a1',
    versionId: null,
    songId: null,
    songName: null,
    finalJson: {
      grade: 'D',
      overall_score: 51,
      danceability_score: 40,
      top_fixes: [
        'True peak is hitting 0.0 dBTP — keep it below −1.0 dBTP.',
        'Reduce sub-bass buildup (20–200 Hz).',
        'Automate stereo width deliberately.',
      ],
      phases: [{ phase: 1, name: 'Universal Mix Analysis', data: { lufs: -9.2, true_peak_db: 0.0 } }],
    },
    shareToken: null,
    ...over,
  };
}

describe('DropZoneView (story 6.3 AC1 — UX-DR27)', () => {
  it('renders the full-bleed zone with mono hints and ZERO form fields', () => {
    const html = renderToStaticMarkup(<DropZoneView onFile={() => {}} error={null} />);
    expect(html).toContain('data-testid="anon-drop-zone"');
    expect(html).toContain('WAV · FLAC · MP3 · ≤250 MB');
    expect(html).toContain('Choose a file');
    // Zero FORM fields: the only input is the hidden file picker.
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

describe('ExplainerLine (AC2 — rotating educational one-liners)', () => {
  it('rotates through phase explainers by tick', () => {
    const a = renderToStaticMarkup(<ExplainerLine tick={0} />);
    const b = renderToStaticMarkup(<ExplainerLine tick={1} />);
    expect(a).toContain('rotating-explainer');
    expect(a).not.toEqual(b);
  });
});

describe('AnonReportView (AC3 — visible hero + BlurLocked depth)', () => {
  it('shows grade hero, #1 finding, and streaming readiness fully visible', () => {
    const html = renderToStaticMarkup(
      <AnonReportView results={results()} locked onUnlock={() => {}} />,
    );
    expect(html).toContain('anon-report');
    expect(html).toMatch(/>D</); // GradeHero letter
    expect(html).toContain('#1 finding');
    expect(html).toContain('True peak is hitting 0.0 dBTP');
    expect(html).toContain('Streaming readiness');
  });

  it('locks the deeper findings with the AC3 reason copy and real count', () => {
    const html = renderToStaticMarkup(
      <AnonReportView results={results()} locked onUnlock={() => {}} />,
    );
    expect(html).toContain('Create a free account to keep this report + see all 3 findings.');
    expect(html).toContain('2 more findings behind the blur');
  });

  it('renders unlocked with no blur overlay once claimed', () => {
    const html = renderToStaticMarkup(
      <AnonReportView results={results()} locked={false} onUnlock={() => {}} />,
    );
    expect(html).not.toContain('Create a free account to keep this report');
  });

  it('tolerates a report with no findings (no #1 card, no crash)', () => {
    const html = renderToStaticMarkup(
      <AnonReportView
        results={results({ finalJson: { grade: 'B', overall_score: 82, phases: [] } })}
        locked
        onUnlock={() => {}}
      />,
    );
    expect(html).toContain('anon-report');
    expect(html).not.toContain('#1 finding');
  });
});
