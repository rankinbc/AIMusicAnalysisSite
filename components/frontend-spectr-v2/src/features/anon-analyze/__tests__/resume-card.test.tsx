// @vitest-environment jsdom
// resume-card.test.tsx — task G5: ResumeCard is now a plain, guest-driven
// static card (no job-status shape, no dismiss — see ResumeCard.tsx). The
// old resume-dismissed.ts localStorage helper it used to pair with is
// deleted along with the rest of the anon-job vertical it served.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ResumeCard } from '../ResumeCard';

describe('ResumeCard (G5 — guest landing resume)', () => {
  it('shows the 24-hour copy and a link to the library', () => {
    const html = renderToStaticMarkup(<ResumeCard />);
    expect(html).toContain('data-testid="resume-card"');
    expect(html).toContain('Your analysis is saved for 24 hours.');
    expect(html).toContain('href="/library"');
    expect(html).toContain('data-testid="resume-open"');
  });
});
