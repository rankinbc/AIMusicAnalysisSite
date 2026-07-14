import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AuthContext } from '../../../auth/AuthContext';
import type { AuthedUser } from '../../../api/types';
import { PublicChrome } from '../../../components/PublicChrome';
import { PricingPage } from '../../../routes/pricing';
import { LandingPage } from '../LandingPage';
import { SampleReportEmbed } from '../SampleReportEmbed';
import { SAMPLE_REPORT } from '../sample-report';

// Story 6.1 — static renders (the FeedView idiom: plain <a> anchors so no
// RouterProvider is needed; effects don't run, so no fetch fires).

describe('PublicChrome (story 6.1 AC3 — UX-DR6 slim chrome)', () => {
  it('renders brand + Pricing + Sign in + Analyze free with correct hrefs (anon variant)', () => {
    // No AuthProvider → useOptionalAuth() is null → anon chrome.
    const html = renderToStaticMarkup(<PublicChrome />);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).toContain('Analyze free');
    expect(html).not.toContain('Open library');
    expect(html).toContain('SPEC'); // wordmark
  });

  it('swaps to "Open library" for an authed user (no register dead-end mid-upgrade)', () => {
    const user: AuthedUser = { id: 'u1', email: 'a@b', handle: 'a', displayName: null, tier: 'free' };
    const value = { user, accessToken: 't', isLoading: false } as never;
    const html = renderToStaticMarkup(
      <AuthContext.Provider value={value}>
        <PublicChrome />
      </AuthContext.Provider>,
    );
    expect(html).toContain('Open library');
    expect(html).toContain('href="/library"');
    expect(html).not.toContain('href="/register"');
    expect(html).not.toContain('Sign in');
  });
});

describe('SampleReportEmbed (story 6.1 AC1 — UX-DR24 live sample, not a screenshot)', () => {
  it('renders the real grade hero, metadata pills, and all findings', () => {
    const html = renderToStaticMarkup(<SampleReportEmbed />);
    // The grade letter as element text (`>F<`), not a substring of other copy.
    expect(html).toMatch(new RegExp(`>${SAMPLE_REPORT.grade}<`));
    expect(html).toContain(`${SAMPLE_REPORT.bpm}`);
    expect(html).toContain(SAMPLE_REPORT.detectedKey);
    expect(html).toContain(SAMPLE_REPORT.lufs.toFixed(1));
    for (const f of SAMPLE_REPORT.findings) {
      expect(html).toContain(f.tag);
    }
    expect(html).toContain('real pipeline output');
    expect(html).toContain('Get yours free');
  });

  it('sample data stays honest — real trimmed values, not marketing numbers', () => {
    // Pin the provenance: these values come from schemas/samples/sample1_8aeef3b4.json.
    expect(SAMPLE_REPORT.grade).toBe('F');
    expect(SAMPLE_REPORT.overallScore).toBe(42);
    expect(SAMPLE_REPORT.findings).toHaveLength(3);
  });
});

describe('LandingPage (story 6.1 AC1)', () => {
  const html = renderToStaticMarkup(<LandingPage />);

  it('renders the primary CTA with the exact FR40 label', () => {
    expect(html).toContain('data-testid="landing-cta"');
    expect(html).toContain('Analyze my track free');
  });

  it('renders chrome, sample embed, honesty strip, and footer links', () => {
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('Live sample report');
    expect(html).toContain('No AI training on your audio');
    expect(html).toContain('Reports stay yours forever');
    expect(html).toContain('href="/login"');
  });
});

describe('PricingPage (story 6.1 AC2 — UX-DR25 polish)', () => {
  const html = renderToStaticMarkup(<PricingPage />);

  it('states tax honesty up front and restates terms at the buttons', () => {
    expect(html).toContain('Tax is calculated and shown at checkout');
    expect(html).toContain('Monthly renews monthly');
    expect(html).toContain('cancel anytime in two clicks');
    expect(html).toContain('One-time purchase · credits never expire');
  });

  it('keeps the honest header and renders the slim chrome', () => {
    expect(html).toContain('Honest billing. No asterisks.');
    expect(html).toContain('Analyze free'); // PublicChrome CTA
    expect(html).not.toContain('*'); // no asterisks, literally
  });
});
