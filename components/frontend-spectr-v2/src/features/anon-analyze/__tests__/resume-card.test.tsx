// @vitest-environment jsdom
// resume-card.test.tsx — task G5: ResumeCard is now a plain, guest-driven
// static card (no job-status shape, no dismiss — see ResumeCard.tsx). The
// old resume-dismissed.ts localStorage helper it used to pair with is
// deleted along with the rest of the anon-job vertical it served.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ResumeCard } from '../ResumeCard';

describe('ResumeCard (G5 — guest landing resume)', () => {
  // G5 fix1 item 7 — the guest lifetime is a server flag (`guest_ttl_hours`),
  // not a client constant; ResumeCard makes no network call, so the copy no
  // longer states a number that could drift from it.
  it('shows number-free copy and a link to the library', () => {
    const html = renderToStaticMarkup(<ResumeCard />);
    expect(html).toContain('data-testid="resume-card"');
    expect(html).toContain('Your guest work is still here — pick up where you left off.');
    expect(html).not.toMatch(/\d+\s*hours?/i);
    expect(html).toContain('href="/library"');
    expect(html).toContain('data-testid="resume-open"');
  });
});
