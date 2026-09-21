import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DropZoneView } from '../AnalyzePage';

// Story 6.3 — static render of the one pure piece that survived task G5's
// teaser removal (AnonReportView/InlineRegisterCard/ExplainerLine are gone —
// /analyze no longer renders a progress/report state of its own, see
// AnalyzePage.tsx and analyze-guest-upload.test.tsx for the page-level
// behavior).

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
