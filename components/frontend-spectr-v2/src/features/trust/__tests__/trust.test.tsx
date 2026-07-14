import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LandingPage } from '../../landing/LandingPage';
import { PricingPage } from '../../../routes/pricing';
import { NoTrainingPage, PLEDGE_VERSION } from '../../../routes/trust.no-training';
import { ResultsForeverPage } from '../../../routes/trust.results-forever';
import { PrivacyDefaultsPage } from '../../../routes/trust.privacy';

// Story 6.2 — static renders (6-1 idiom: plain <a>, no providers needed;
// PublicChrome renders its anon variant outside AuthProvider).

describe('trust pages (story 6.2 AC1/3/4)', () => {
  it('no-training pledge is VERSIONED and carries the load-bearing claims', () => {
    const html = renderToStaticMarkup(<NoTrainingPage />);
    expect(html).toContain(`Pledge version ${PLEDGE_VERSION}`);
    expect(html).toContain('data-testid="pledge-version"');
    expect(html).toContain('never sent to any LLM');
    expect(html).toContain('Anthropic API');
    expect(html).toContain('does not train');
  });

  it('results-forever states the honest raw-audio distinction', () => {
    const html = renderToStaticMarkup(<ResultsForeverPage />);
    expect(html).toContain('Reports never expire');
    expect(html).toContain('30 days');
    expect(html).toContain('90 days');
    expect(html).toContain('the report'); // report survives audio purge
  });

  it('privacy defaults cover the shipped behaviors and disclaim legal-policy status', () => {
    const html = renderToStaticMarkup(<PrivacyDefaultsPage />);
    expect(html).toContain('Private by default');
    expect(html).toContain('revocable');
    expect(html).toContain('72 hours');
    expect(html).toContain('not a legal privacy policy');
    // Honest third-party disclosure — no "no trackers" overclaim (Sentry/PostHog exist).
    expect(html).toContain('Sentry');
    expect(html).toContain('PostHog');
  });

  it('each page renders chrome + cross-links to the other trust pages', () => {
    for (const [Page, others] of [
      [NoTrainingPage, ['/trust/results-forever', '/trust/privacy']],
      [ResultsForeverPage, ['/trust/no-training', '/trust/privacy']],
      [PrivacyDefaultsPage, ['/trust/no-training', '/trust/results-forever']],
    ] as const) {
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain('SPEC'); // PublicChrome wordmark
      for (const href of others) expect(html).toContain(`href="${href}"`);
    }
  });
});

describe('trust links on funnel surfaces (story 6.2 AC2)', () => {
  it('landing footer links all three trust pages', () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toContain('href="/trust/no-training"');
    expect(html).toContain('href="/trust/results-forever"');
    expect(html).toContain('href="/trust/privacy"');
  });

  it('pricing footer links all three trust pages', () => {
    const html = renderToStaticMarkup(<PricingPage />);
    expect(html).toContain('href="/trust/no-training"');
    expect(html).toContain('href="/trust/results-forever"');
    expect(html).toContain('href="/trust/privacy"');
  });
});
